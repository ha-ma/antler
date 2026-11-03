"""A のシミュレーションのトレース → 正解付きの JudgeRequest（L1 の校正用。B2-7、Step 4）。

docs/specs/edge-l1-calibration R1〜R6。edge が実行時に L1 へ送るのと同じ場面・同じ組み立てで
JudgeRequest を作り、4 問の正解ラベルを付けて JSONL に書く。

- 場面: 赤の候補（conf ≥ judge.threshold）が 2 tick 続いた赤の始まりと、そこから 0.4 秒
  （1 / l1.rate_hz）ごとの赤の候補の tick から 1 つ選ぶ。track はトラッカーの窓（1 秒）で切る
- 組み立て: detector.l1.request.build_request（JudgeRequest の検証つき）。車の状態は既定で
  VehicleContext() の固定値（edge-l1 R2「校正の学習でも同じ固定値」）
- 正解: その時刻の真の位置と、その先 6 秒の動き（先読み）から機械的に

sim はまだトレースを書き出さないので（Deferred。sim は編集しない）、sim の鹿の 5 パターンの定数を
写したシード付きの合成トレース（--synthetic）も作れる。合成は sim の物理の写しではない。

    python dataset/export_l1_labels.py --synthetic --seed 7 --out dataset/out/l1_labels.jsonl
    python dataset/export_l1_labels.py --traces sim_traces.jsonl --out dataset/out/l1_labels.jsonl
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Final

import numpy as np

from detector.config import JudgeConfig, L1Config, TrackerConfig
from detector.fusion import L1Target
from detector.l0.tracker import MAX_POINTS, MIN_CLOSING_MPS, MIN_SPAN_S
from detector.l1.client import L1Unavailable
from detector.l1.request import VehicleContext, build_request

if TYPE_CHECKING:
    from collections.abc import Iterable, Iterator, Sequence

__all__ = [
    "Example",
    "Tick",
    "Trace",
    "TraceError",
    "build_example",
    "export",
    "label_at",
    "load_traces",
    "main",
    "query_times",
    "synthetic_traces",
    "trace_to_json",
    "track_at",
    "visible",
]

FORMAT: Final = "antler-sim-trace"
VERSION: Final = 1
TICK_MS: Final = 100  # sim の DETECT_TICK_MS

# 検知の条件（sim の detection.ts の cameraSees と同じ。画角は TrackerConfig の hfov の半分）
CAMERA_FORWARD_M: Final = 1.2
DETECT_RANGE_M: Final = 120.0
HALF_FOV_DEG: Final = TrackerConfig().hfov_deg / 2.0
LANE_HALF_M: Final = TrackerConfig().lane_half_width_m
CAR_LANE_D: Final = -1.75  # sim の LANE_CENTER_D（左車線の中央）

# edge の既定値（実行時に L1 が聞かれる場面と同じにする）
RED_THRESHOLD: Final = JudgeConfig().threshold
RED_FRAMES: Final = 2  # B2-3: 0.8 以上が 2 フレームで赤
QUERY_INTERVAL_MS: Final = round(1000.0 / L1Config().rate_hz)
WINDOW_MS: Final = TrackerConfig().window_s * 1000.0
MAX_AGE_MS: Final = TrackerConfig().max_age_s * 1000.0
MIN_CONF: Final = TrackerConfig().min_conf

# 正解ラベルの閾値（R5。推奨で決定）
LOOKAHEAD_MS: Final = 6000.0
DANGER_HORIZON_S: Final = 6.0
TOWARD_MPS: Final = 0.5
STILL_MPS: Final = 0.3

# 確信度の仮の式（R3。sim は確信度を持たない。実値は Deferred）
CONF_BASE: Final = {"deer": 0.88, "sign": 0.82, "post": 0.82, "snow": 0.82}
CONF_NIGHT: Final = 0.04
CONF_FAR: Final = 0.10
CONF_SIGMA: Final = 0.04
CONF_RANGE: Final = (0.40, 0.99)

LIGHTS: Final = ("dawn", "day", "dusk", "night")
WEATHERS: Final = ("clear", "cloudy", "snow", "fog")
ZONES: Final = ("inside", "outside")
KINDS: Final = ("deer", "sign", "post", "snow")
PATTERNS: Final = ("roadside", "eyeshine", "crossing", "herd", "frozen")
POSES: Final = ("idle", "walk", "run", "look")
SOURCES: Final = ("sim", "synthetic")
CONTEXTS: Final = ("fixed", "actual")
QUESTIONS: Final = ("alert_level", "on_roadway", "static_shoulder", "false_positive")

DEFAULT_EXAMPLES: Final = 240
DEFAULT_MIN_PER_QUESTION: Final = 100
EXIT_OK, EXIT_SHORT, EXIT_INPUT = 0, 1, 2


class TraceError(Exception):
    """トレースの形が違う（行番号と欄の名前つき）・問い合わせが組み立てられない。"""


@dataclass(frozen=True)
class Tick:
    t: float  # ms
    car_s: float
    car_d: float
    car_speed: float  # m/s
    obj_s: float
    obj_d: float
    occluded: bool
    pose: str | None = None
    conf: float | None = None

    @property
    def lateral(self) -> float:
        """カメラから見た横の位置（m、右が正）。"""
        return self.obj_d - self.car_d

    @property
    def ahead(self) -> float:
        return self.obj_s - (self.car_s + CAMERA_FORWARD_M)

    @property
    def gap(self) -> float:
        """車から物までの道のり（m）。"""
        return self.obj_s - self.car_s

    @property
    def distance(self) -> float:
        return math.hypot(self.ahead, self.lateral)


@dataclass(frozen=True)
class Trace:
    id: str
    source: str
    seed: int
    light: str
    weather: str
    zone: str
    kind: str
    pattern: str | None
    ticks: tuple[Tick, ...]


@dataclass(frozen=True)
class Example:
    id: str
    request: dict[str, object]
    labels: dict[str, object]
    meta: dict[str, object]

    def to_json(self) -> dict[str, object]:
        return {"id": self.id, "request": self.request, "labels": self.labels, "meta": self.meta}


# ---- R1: トレースの読み込み ----


def _bad(line: int, field: str, why: str) -> TraceError:
    return TraceError(f"{line} 行目: {field}: {why}")


def _reject_constant(name: str) -> float:
    msg = f"JSON に {name} は書けない"
    raise ValueError(msg)


def _num(raw: dict[str, object], key: str, line: int, where: str) -> float:
    v = raw.get(key)
    if isinstance(v, bool) or not isinstance(v, int | float) or not math.isfinite(v):
        raise _bad(line, f"{where}{key}", "有限の数ではない")
    return float(v)


def _word(
    raw: dict[str, object], key: str, vocab: Sequence[str], line: int, where: str = ""
) -> str:
    v = raw.get(key)
    if v not in vocab:
        raise _bad(line, f"{where}{key}", "語彙の外")
    return str(v)


def _tick(raw: object, line: int, i: int) -> Tick:
    where = f"ticks[{i}]."
    if not isinstance(raw, dict):
        raise _bad(line, f"ticks[{i}]", "オブジェクトではない")
    occluded = raw.get("occluded")
    if not isinstance(occluded, bool):
        raise _bad(line, f"{where}occluded", "真偽値ではない")
    pose = raw.get("pose")
    if pose is not None and pose not in POSES:
        raise _bad(line, f"{where}pose", "語彙の外")
    conf = None
    if raw.get("conf") is not None:
        conf = _num(raw, "conf", line, where)
        if not 0.0 <= conf <= 1.0:
            raise _bad(line, f"{where}conf", "0〜1 ではない")
    return Tick(
        t=_num(raw, "t", line, where),
        car_s=_num(raw, "carS", line, where),
        car_d=_num(raw, "carD", line, where),
        car_speed=_num(raw, "carSpeed", line, where),
        obj_s=_num(raw, "objS", line, where),
        obj_d=_num(raw, "objD", line, where),
        occluded=occluded,
        pose=pose,
        conf=conf,
    )


def _trace(raw: object, line: int) -> Trace:
    if not isinstance(raw, dict):
        raise _bad(line, "行", "オブジェクトではない")
    if raw.get("format") != FORMAT or raw.get("version") != VERSION:
        raise _bad(line, "format/version", f"{FORMAT} の版 {VERSION} ではない")
    tid = raw.get("id")
    if not isinstance(tid, str) or not tid:
        raise _bad(line, "id", "空でない文字列ではない")
    seed = raw.get("seed")
    if isinstance(seed, bool) or not isinstance(seed, int):
        raise _bad(line, "seed", "整数ではない")
    obj = raw.get("object")
    if not isinstance(obj, dict):
        raise _bad(line, "object", "オブジェクトではない")
    kind = _word(obj, "kind", KINDS, line, "object.")
    pattern = obj.get("pattern")
    if (kind == "deer" and pattern not in PATTERNS) or (kind != "deer" and pattern is not None):
        raise _bad(line, "object.pattern", "鹿は 5 パターンのどれか、鹿でない物は null")
    ticks_raw = raw.get("ticks")
    if not isinstance(ticks_raw, list) or not ticks_raw:
        raise _bad(line, "ticks", "1 つ以上の配列ではない")
    ticks = tuple(_tick(t, line, i) for i, t in enumerate(ticks_raw))
    for i in range(1, len(ticks)):
        if ticks[i].t <= ticks[i - 1].t:
            raise _bad(line, f"ticks[{i}].t", "狭義の昇順ではない")
    return Trace(
        id=tid,
        source=_word(raw, "source", SOURCES, line),
        seed=seed,
        light=_word(raw, "light", LIGHTS, line),
        weather=_word(raw, "weather", WEATHERS, line),
        zone=_word(raw, "zone", ZONES, line),
        kind=kind,
        pattern=pattern,
        ticks=ticks,
    )


def load_traces(lines: Iterable[str]) -> list[Trace]:
    """JSONL の行から。1 行でも違えば TraceError（行番号つき）で全体を拒否。空行は飛ばす。"""
    traces: list[Trace] = []
    seen: set[str] = set()
    for n, text in enumerate(lines, start=1):
        if not text.strip():
            continue
        try:
            raw = json.loads(text, parse_constant=_reject_constant)
        except (ValueError, RecursionError) as exc:
            raise _bad(n, "行", "JSON ではない") from exc
        trace = _trace(raw, n)
        if trace.id in seen:
            raise _bad(n, "id", "重複")
        seen.add(trace.id)
        traces.append(trace)
    return traces


def trace_to_json(trace: Trace) -> dict[str, object]:
    ticks = []
    for k in trace.ticks:
        tick: dict[str, object] = {
            "t": k.t,
            "carS": k.car_s,
            "carD": k.car_d,
            "carSpeed": k.car_speed,
            "objS": k.obj_s,
            "objD": k.obj_d,
            "occluded": k.occluded,
            "pose": k.pose,
        }
        if k.conf is not None:
            tick["conf"] = k.conf
        ticks.append(tick)
    return {
        "format": FORMAT,
        "version": VERSION,
        "id": trace.id,
        "source": trace.source,
        "seed": trace.seed,
        "light": trace.light,
        "weather": trace.weather,
        "zone": trace.zone,
        "object": {"kind": trace.kind, "pattern": trace.pattern},
        "ticks": ticks,
    }


# ---- R2: 合成トレース（sim の deer-spawn.ts・deer-motion.ts の定数を写した簡略な運動） ----

PATTERN_WEIGHTS: Final = {  # sim の PATTERN_WEIGHTS
    "roadside": 0.3,
    "eyeshine": 0.2,
    "crossing": 0.25,
    "herd": 0.15,
    "frozen": 0.1,
}
DECOY_SHARE: Final = 0.25
DECOY_D: Final = {"sign": (4.0, 7.0), "post": (3.5, 5.0), "snow": (2.5, 6.0)}
LIGHT_WEIGHTS: Final = {"day": 0.3, "dawn": 0.1, "dusk": 0.2, "night": 0.4}
WEATHER_WEIGHTS: Final = {"clear": 0.5, "cloudy": 0.2, "snow": 0.2, "fog": 0.1}
CAR_KMH: Final = (30.0, 80.0)
START_GAP_M: Final = (130.0, 160.0)
END_BEHIND_M: Final = -10.0
MAX_TRACE_MS: Final = 25000.0
# deer-motion.ts の値
ROADSIDE_D: Final = (4.4, 6.0)
EYESHINE_D: Final = (9.5, 13.5)
WAIT_D: Final = (4.8, 5.8)
HERD_SPACING_M: Final = 2.1
HERD_DELAY_MS: Final = 1000.0
HERD_DELAY_JITTER_MS: Final = 150.0
FOREST_EDGE_M: Final = 9.0
GONE_D_M: Final = 14.0
TRIGGER_M: Final = (80.0, 100.0)
CROSS_SPEED: Final = (2.6, 4.6)
FROZEN_IN: Final = (2.4, 3.2)
FROZEN_OUT_MPS: Final = 6.0
FROZEN_TIMEOUT_MS: Final = 12000.0
RAMP_MS: Final = 600.0
RAMP_START: Final = 0.15
LOOK_RANGE_M: Final = 130.0
RUN_ABOVE_MPS: Final = 3.4
HALF: Final = 0.5


def _pick(rng: np.random.Generator, weights: dict[str, float]) -> str:
    keys = list(weights)
    p = np.array([weights[k] for k in keys], dtype=float)
    return keys[int(rng.choice(len(keys), p=p / p.sum()))]


def _u(rng: np.random.Generator, lo_hi: tuple[float, float]) -> float:
    return float(rng.uniform(*lo_hi))


def _ramp(elapsed_ms: float) -> float:
    return RAMP_START + (1.0 - RAMP_START) * min(1.0, max(0.0, elapsed_ms) / RAMP_MS)


@dataclass
class _Motion:
    """1 物体の動き（d だけが変わる。s は変えない。sim と同じ）。"""

    pattern: str | None
    d: float
    target_dir: float  # 渡る向き（d の増える向きが +1）
    trigger_m: float
    speed: float
    delay_ms: float
    started_at: float | None = None
    stood_at: float | None = None
    pose: str | None = None
    gone: bool = False

    def step(self, t: float, gap: float, dt_s: float) -> None:
        if self.pattern is None:  # 鹿でない物は動かない
            return
        if self.pattern in ("roadside", "eyeshine"):
            self.pose = "look" if -10.0 < gap <= LOOK_RANGE_M else "idle"
            return
        if self.started_at is None:
            self.pose = "look" if -10.0 < gap <= LOOK_RANGE_M else "idle"
            if gap <= self.trigger_m:
                self.started_at = t + self.delay_ms
            return
        if t < self.started_at:
            self.pose = "look"
            return
        if self.pattern == "frozen":
            self._step_frozen(t, dt_s)
            return
        v = self.speed * _ramp(t - self.started_at)
        self.d += self.target_dir * v * dt_s
        self.pose = "run" if v > RUN_ABOVE_MPS else "walk"
        self.gone = self.d * self.target_dir >= GONE_D_M

    def _step_frozen(self, t: float, dt_s: float) -> None:
        if self.stood_at is None:
            started = self.started_at if self.started_at is not None else t
            v = self.speed * _ramp(t - started)
            nxt = self.d + self.target_dir * v * dt_s
            if (CAR_LANE_D - nxt) * self.target_dir <= 0:
                self.d, self.stood_at, self.pose = CAR_LANE_D, t, "look"
            else:
                self.d, self.pose = nxt, "walk"
            return
        if t - self.stood_at < FROZEN_TIMEOUT_MS:
            self.pose = "look"
            return
        self.d += (
            self.target_dir * FROZEN_OUT_MPS * _ramp(t - self.stood_at - FROZEN_TIMEOUT_MS) * dt_s
        )
        self.pose = "run"
        self.gone = self.d * self.target_dir >= GONE_D_M


def _synthetic_trace(seed: int, index: int) -> Trace:
    rng = np.random.default_rng([seed, index])
    light = _pick(rng, LIGHT_WEIGHTS)
    weather = _pick(rng, WEATHER_WEIGHTS)
    side = -1.0 if rng.random() < HALF else 1.0
    if rng.random() < DECOY_SHARE:
        kind = _pick(rng, dict.fromkeys(DECOY_D, 1.0))
        pattern = None
        motion = _Motion(None, side * _u(rng, DECOY_D[kind]), 0.0, 0.0, 0.0, 0.0)
    else:
        kind = "deer"
        pattern = _pick(rng, PATTERN_WEIGHTS)
        trigger = _u(rng, TRIGGER_M)
        if pattern == "roadside":
            motion = _Motion(pattern, side * _u(rng, ROADSIDE_D), 0.0, trigger, 0.0, 0.0)
        elif pattern == "eyeshine":
            motion = _Motion(pattern, side * _u(rng, EYESHINE_D), 0.0, trigger, 0.0, 0.0)
        elif pattern == "frozen":
            d0 = side * _u(rng, WAIT_D)
            toward = 1.0 if d0 < CAR_LANE_D else -1.0
            motion = _Motion(pattern, d0, toward, trigger, _u(rng, FROZEN_IN), 0.0)
        else:
            index_in_herd = (
                int(rng.integers(0, int(rng.integers(2, 6)))) if pattern == "herd" else 0
            )
            d0 = side * (_u(rng, WAIT_D) + HERD_SPACING_M * index_in_herd)
            jitter = _u(rng, (-HERD_DELAY_JITTER_MS, HERD_DELAY_JITTER_MS))
            delay = index_in_herd * (HERD_DELAY_MS + jitter)
            motion = _Motion(pattern, d0, -side, trigger, _u(rng, CROSS_SPEED), delay)
    speed = _u(rng, CAR_KMH) / 3.6
    obj_s = _u(rng, START_GAP_M)
    ticks: list[Tick] = []
    t = 0.0
    dt_s = TICK_MS / 1000.0
    while t <= MAX_TRACE_MS:
        car_s = speed * t / 1000.0
        gap = obj_s - car_s
        if gap < END_BEHIND_M or motion.gone:
            break
        motion.step(t, gap, dt_s)
        occluded = pattern == "eyeshine" or abs(motion.d) >= FOREST_EDGE_M
        ticks.append(
            Tick(
                t=t,
                car_s=round(car_s, 3),
                car_d=CAR_LANE_D,
                car_speed=round(speed, 4),
                obj_s=round(obj_s, 3),
                obj_d=round(motion.d, 4),
                occluded=occluded,
                pose=motion.pose,
            )
        )
        t += TICK_MS
    return Trace(
        id=f"syn-{seed}-{index}",
        source="synthetic",
        seed=seed,
        light=light,
        weather=weather,
        zone="inside",
        kind=kind,
        pattern=pattern,
        ticks=tuple(ticks),
    )


def synthetic_traces(seed: int, start: int = 0) -> Iterator[Trace]:
    """番号 start から順に、限りなく作る。i 番目は (seed, i) だけで決まる。"""
    i = start
    while True:
        yield _synthetic_trace(seed, i)
        i += 1


# ---- R3・R4: 問い合わせの場面 ----


def visible(tick: Tick) -> bool:
    """sim の cameraSees と同じ（遮蔽・カメラの後ろ・120 m・画角 35°）。"""
    if tick.occluded or tick.ahead <= 0.0 or tick.distance > DETECT_RANGE_M:
        return False
    return math.degrees(math.atan2(abs(tick.lateral), tick.ahead)) <= HALF_FOV_DEG


def _stable(text: str) -> int:
    return int(hashlib.sha256(text.encode("utf-8")).hexdigest()[:8], 16)


def confidences(trace: Trace, seed: int) -> list[float]:
    """tick ごとの確信度。トレースの値があればそれ、無ければ仮の式＋揺らぎ。

    揺らぎは seed とトレースの id だけで決まる（トレースの順に依らない）。
    """
    rng = np.random.default_rng([seed, _stable(trace.id)])
    noise = rng.normal(0.0, CONF_SIGMA, size=len(trace.ticks))
    lo, hi = CONF_RANGE
    out = []
    for tick, e in zip(trace.ticks, noise, strict=True):
        if tick.conf is not None:
            out.append(tick.conf)
            continue
        c = CONF_BASE[trace.kind] - (CONF_NIGHT if trace.light == "night" else 0.0)
        c -= CONF_FAR * min(1.0, tick.distance / DETECT_RANGE_M)
        out.append(round(min(hi, max(lo, c + float(e))), 4))
    return out


def query_times(trace: Trace, conf: Sequence[float]) -> list[int]:
    """問い合わせの時刻の候補（tick の添字）: 赤の始まりと、そこから 0.4 秒ごとの赤の候補。"""
    ticks = trace.ticks
    cand = [visible(k) and c >= RED_THRESHOLD for k, c in zip(ticks, conf, strict=True)]
    onset = None
    run = 0
    for i, ok in enumerate(cand):
        contiguous = i > 0 and ticks[i].t - ticks[i - 1].t <= TICK_MS * 1.5
        run = (run + 1 if contiguous else 1) if ok else 0
        if run >= RED_FRAMES:
            onset = i
            break
    if onset is None:
        return []
    t0 = ticks[onset].t

    def on_beat(t: float) -> bool:  # 赤の始まりから 0.4 秒ごと（tick の半分まで揺れてよい）
        k = round((t - t0) / QUERY_INTERVAL_MS)
        return abs(t - t0 - k * QUERY_INTERVAL_MS) < TICK_MS / 2

    return [i for i in range(onset, len(ticks)) if cand[i] and on_beat(ticks[i].t)]


def _side(lateral: float) -> str:
    return "L" if lateral < 0.0 else "R"


def track_at(
    trace: Trace, conf: Sequence[float], q: int
) -> tuple[list[dict[str, object]], float | None]:
    """edge-l0 のトラッカーと同じ track（窓 1 秒・1 秒を超える途切れで新しいトラック）と TTC。"""
    seg: list[int] = []
    for i in range(q + 1):
        tick = trace.ticks[i]
        if not visible(tick) or conf[i] < MIN_CONF:
            continue
        if seg and tick.t - trace.ticks[seg[-1]].t > MAX_AGE_MS:
            seg = []
        seg.append(i)
    tq = trace.ticks[q].t
    pts = [i for i in seg if tq - trace.ticks[i].t <= WINDOW_MS][-MAX_POINTS:]
    first = trace.ticks[pts[0]]
    out: list[dict[str, object]] = []
    for i in pts:
        tick = trace.ticks[i]
        span = (tick.t - first.t) / 1000.0
        lateral_mps = 0.0
        if span >= MIN_SPAN_S:
            rightward = (tick.lateral - first.lateral) / span
            lateral_mps = rightward if _side(tick.lateral) == "L" else -rightward
        out.append(
            {
                "t": round(min(0.0, (tick.t - tq) / 1000.0), 3),
                "conf": float(conf[i]),
                "distanceM": round(tick.distance, 3),
                "lateralMps": round(lateral_mps, 3) + 0.0,  # -0.0 を書かない
                "side": _side(tick.lateral),
                "pos": "lane" if abs(tick.lateral) <= LANE_HALF_M else "shoulder",
            }
        )
    last = trace.ticks[pts[-1]]
    span = (last.t - first.t) / 1000.0
    ttc = None
    if span >= MIN_SPAN_S:
        closing = (first.distance - last.distance) / span
        if closing > MIN_CLOSING_MPS:
            ttc = round(last.distance / closing, 3)
    return out, ttc


def _context(trace: Trace, tick: Tick, mode: str) -> VehicleContext:
    if mode == "fixed":
        return VehicleContext()
    return VehicleContext(
        speed_kmh=round(max(0.0, tick.car_speed) * 3.6, 1),
        zone=trace.zone,
        light=trace.light,
        headlight="off" if trace.light == "day" else "low",
    )


# ---- R5: 正解ラベル ----


def label_at(trace: Trace, q: int, speed_kmh: float, zone: str) -> dict[str, object]:
    """tq の真の位置と、その先 6 秒（車が追い越す前）に車線へ入るか（先読み）から。"""
    tick = trace.ticks[q]
    deer = trace.kind == "deer"
    in_lane = abs(tick.lateral) <= LANE_HALF_M
    lateral_v = 0.0
    if q > 0:
        prev = trace.ticks[q - 1]
        lateral_v = (tick.lateral - prev.lateral) / ((tick.t - prev.t) / 1000.0)
    toward = -lateral_v if tick.lateral > 0 else lateral_v
    enters = any(
        abs(k.lateral) <= LANE_HALF_M
        for k in trace.ticks[q:]
        if k.t - tick.t <= LOOKAHEAD_MS and k.gap > 0.0
    )
    on_roadway = deer and (in_lane or toward >= TOWARD_MPS or enters)
    static_shoulder = deer and not in_lane and abs(lateral_v) < STILL_MPS and not enters
    v_ref = speed_kmh / 3.6
    soon = v_ref > 0.0 and tick.gap / v_ref <= DANGER_HORIZON_S
    if deer and (in_lane or enters) and soon:
        level = "danger"
    else:
        level = "zone" if zone == "inside" else "none"
    return {
        "alert_level": level,
        "on_roadway": on_roadway,
        "static_shoulder": static_shoulder,
        "false_positive": not deer,
    }


# ---- R6: 出力 ----


def build_example(
    trace: Trace,
    conf: Sequence[float],
    q: int,
    *,
    recent_alerts: int,
    model: str,
    context: str,
) -> Example:
    points, ttc = track_at(trace, conf, q)
    tick = trace.ticks[q]
    ctx = _context(trace, tick, context)
    try:
        request = build_request(L1Target(None, 1, points, ttc), recent_alerts, model, ctx)
    except L1Unavailable as exc:
        msg = f"{trace.id}: JudgeRequest に通らない（{exc.error_type}）"
        raise TraceError(msg) from exc
    return Example(
        id=f"{trace.id}@{round(tick.t)}",
        request=request.model_dump(mode="json"),
        labels=label_at(trace, q, ctx.speed_kmh, ctx.zone),
        meta={
            "traceId": trace.id,
            "source": trace.source,
            "kind": trace.kind,
            "pattern": trace.pattern,
            "light": trace.light,
            "zone": trace.zone,
            "speedKmh": round(tick.car_speed * 3.6, 1),
            "context": context,
        },
    )


RECENT_ALERTS: Final = ((1, 0.6), (2, 0.25), (3, 0.15))


def export(
    traces: Iterable[Trace],
    *,
    seed: int,
    examples: int | None = None,
    per_trace: int = 1,
    model: str = L1Config().model,
    context: str = "fixed",
    max_traces: int | None = None,
) -> tuple[list[Example], dict[str, object]]:
    """トレースから問い合わせを作る。examples があればその件数で止める。"""
    rows: list[Example] = []
    used: set[str] = set()
    skipped = 0
    values = [a for a, _ in RECENT_ALERTS]
    weights = [p for _, p in RECENT_ALERTS]
    for seen, trace in enumerate(traces, start=1):
        conf = confidences(trace, seed)
        pool = query_times(trace, conf)
        if pool:
            rng = np.random.default_rng([seed, _stable(trace.id), 2])
            take = min(per_trace, len(pool))
            if examples is not None:
                take = min(take, examples - len(rows))
            picks = sorted(int(i) for i in rng.choice(len(pool), size=take, replace=False))
            for k in picks:
                n = int(rng.choice(values, p=weights))
                ex = build_example(
                    trace, conf, pool[k], recent_alerts=n, model=model, context=context
                )
                rows.append(ex)
            used.add(trace.id)
        else:
            skipped += 1
        # 止めるのは処理のあと（読んだトレースを --traces で読み直すと同じ行になる）
        if examples is not None and len(rows) >= examples:
            break
        if max_traces is not None and seen >= max_traces:
            break
    return rows, summarize(rows, used, skipped)


def summarize(rows: Sequence[Example], used: set[str], skipped: int) -> dict[str, object]:
    per_question: dict[str, object] = {}
    for q in QUESTIONS:
        counts = Counter(str(r.labels[q]).lower() for r in rows)
        per_question[q] = {
            "n": len(rows),
            "traces": len(used),
            "classes": dict(sorted(counts.items())),
        }
    return {
        "rows": len(rows),
        "traces": len(used),
        "skippedTraces": skipped,
        "perQuestion": per_question,
        "kinds": dict(sorted(Counter(str(r.meta["kind"]) for r in rows).items())),
        "patterns": dict(sorted(Counter(str(r.meta["pattern"]) for r in rows).items())),
    }


def _write_jsonl(path: Path, items: Iterable[dict[str, object]]) -> None:
    """同じディレクトリの一時ファイルに書いてから置き換える（半端な出力を残さない）。"""
    tmp = path.with_name(f".{path.name}.tmp")
    try:
        with tmp.open("w", encoding="utf-8") as f:
            for item in items:
                f.write(
                    json.dumps(item, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
                    + "\n"
                )
        tmp.replace(path)
    finally:
        tmp.unlink(missing_ok=True)


def _seed(text: str) -> int:
    """numpy の SeedSequence は負の数を受けないので、0 以上の整数だけ。"""
    try:
        v = int(text)
    except ValueError as exc:
        msg = "整数ではない"
        raise argparse.ArgumentTypeError(msg) from exc
    if v < 0:
        msg = "0 以上"
        raise argparse.ArgumentTypeError(msg)
    return v


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python dataset/export_l1_labels.py", description=__doc__)
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument(
        "--synthetic", action="store_true", help="合成トレース（sim の定数を写したもの）"
    )
    src.add_argument("--traces", type=Path, help="sim のトレースの JSONL（R1 の形）")
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--seed", type=_seed, default=7)
    p.add_argument("--examples", type=int, default=DEFAULT_EXAMPLES, help="合成の問い合わせの件数")
    p.add_argument("--per-trace", type=int, default=1)
    p.add_argument("--model", default=L1Config().model)
    p.add_argument("--context", choices=CONTEXTS, default="fixed")
    p.add_argument("--min-per-question", type=int, default=DEFAULT_MIN_PER_QUESTION)
    p.add_argument("--write-traces", type=Path, help="使った合成トレースも JSONL に書く")
    return p


def _fail(reason: str, code: int) -> int:
    sys.stderr.write(f"export_l1_labels: {reason}\n")
    return code


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.per_trace < 1 or args.examples < 1:
        return _fail("--per-trace と --examples は 1 以上", EXIT_INPUT)
    try:
        if args.synthetic:
            limit = args.examples * 50  # 赤の候補が出ない設定で止まらないように
            traces: list[Trace] = []

            def tracked() -> Iterator[Trace]:
                for tr in synthetic_traces(args.seed):
                    traces.append(tr)
                    yield tr

            rows, summary = export(
                tracked(),
                seed=args.seed,
                examples=args.examples,
                per_trace=args.per_trace,
                model=args.model,
                context=args.context,
                max_traces=limit,
            )
        else:
            text = args.traces.read_text(encoding="utf-8")
            traces = load_traces(text.splitlines())
            rows, summary = export(
                traces,
                seed=args.seed,
                per_trace=args.per_trace,
                model=args.model,
                context=args.context,
            )
    except TraceError as exc:
        return _fail(str(exc), EXIT_INPUT)
    except (OSError, UnicodeDecodeError) as exc:
        return _fail(f"トレースを読めない（{type(exc).__name__}）", EXIT_INPUT)
    sys.stdout.write(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    distinct = len({r.meta["traceId"] for r in rows})
    if distinct < args.min_per_question:
        need = args.min_per_question
        return _fail(f"別々のトレースが {distinct}（{need} 以上が要る）。書かない", EXIT_SHORT)
    try:
        _write_jsonl(args.out, (r.to_json() for r in rows))
        if args.write_traces is not None and args.synthetic:
            _write_jsonl(args.write_traces, (trace_to_json(t) for t in traces))
    except OSError as exc:
        return _fail(f"{args.out} に書けない（{type(exc).__name__}）", EXIT_INPUT)
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
