"""Day 0 / Day 2 の計測（変更指示 §4 Step 0・Step 6、§6）。入口は scripts/bench_l1.py。

- 計測: L1（local-jev の `POST /v1/systemone`、l1/client.py）を n 回呼んで p50/p95 を出す。
  `--model`（.mlpackage）があれば YOLO（CoreML）を別スレッドで回し、L0 の fps が L1 の併走でどれだけ
  落ちるか（受け入れ基準: 20% 以内）も出す。CoreML の predict は同期なので、YOLO は
  スレッド、L1 は asyncio。同じスレッドで交互に回すと併走にならない
- 比較（`--compare`）: 正解付きのシナリオ（dataset/export_l1_labels.py の出力）を、閾値ルールのみ・
  モデルごとの local-jev に流し、4 問の正解率・ECE・p50/p95 を出す
- 出力は 1 つの JSON（schema: antler.bench_l1/1）と、その要約の表。そのまま貼れる形

実機が無い環境では L1 と CoreML をフェイクに差し替え、動くことだけテストする。
"""

from __future__ import annotations

import argparse
import asyncio
import dataclasses
import importlib.metadata
import json
import math
import platform
import statistics
import subprocess
import sys
import threading
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Final

import numpy as np
from pydantic import ValidationError

from detector.config import Config, ConfigError, load_config
from detector.l0.coreml import COMPUTE_UNIT_NAMES
from detector.l1.client import JudgeClient, L1Unavailable, make_client, resolve_base_url
from detector.schema import JudgeRequest

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable, Sequence

    from detector.ports import Detector

__all__ = [
    "SCHEMA",
    "Bench",
    "YoloLoop",
    "ece",
    "main",
    "percentile",
    "render_table",
    "rule_answer",
    "run_bench",
    "run_compare",
    "run_yolo_alone",
    "summarize_ms",
]

SCHEMA: Final = "antler.bench_l1/1"
FPS_DROP_LIMIT_PCT: Final = 20.0  # §6: YOLO と L1 の併走で L0 の fps 低下が 20% 以内
QUESTIONS: Final = ("alert_level", "on_roadway", "static_shoulder", "false_positive")
NOUL_QUESTIONS: Final = QUESTIONS[1:]
ECE_BINS: Final = 10
STILL_MPS: Final = 0.3  # ルールの「止まっている」（export_l1_labels の STILL_MPS と同じ）
EXIT_OK, EXIT_INPUT, EXIT_UNREACHABLE = 0, 2, 3
FRAME_COUNT: Final = 4
READY_FRAMES: Final = 5  # 単独の fps を測り始める前に済ませる推論の回数
MIN_ANSWERED_RATIO: Final = 0.8  # 併走の区間で L1 が答えた割合の下限（下回ると判定しない）
FRAME_SHAPE: Final = (480, 640, 3)  # パイプラインの 640×480・BGR
# ch6「B 遅延」: 推論の予算と目標。設定（infer.budget_ms は警告のしきい値）では変えない
INFER_BUDGET_MS: Final = 100.0
INFER_TARGET_MS: Final = 50.0
EXIT_SLOW: Final = 4  # YOLO 単独: 測れたが ch6 の予算か目標の fps を満たさない


# ---- 統計 ----


def percentile(sorted_values: Sequence[float], q: float) -> float:
    """線形補間のパーセンタイル（q は 0〜100）。空は nan。"""
    if not sorted_values:
        return math.nan
    if len(sorted_values) == 1:
        return float(sorted_values[0])
    pos = (len(sorted_values) - 1) * q / 100.0
    lo = math.floor(pos)
    hi = math.ceil(pos)
    frac = pos - lo
    return float(sorted_values[lo] * (1 - frac) + sorted_values[hi] * frac)


def _r(value: float, digits: int = 1) -> float | None:
    """JSON に NaN を出さない（None にする）。"""
    return None if not math.isfinite(value) else round(value, digits)


def summarize_ms(samples: Iterable[float]) -> dict[str, object]:
    values = sorted(samples)
    if not values:
        return {"n": 0, "p50_ms": None, "p95_ms": None, "max_ms": None, "mean_ms": None}
    return {
        "n": len(values),
        "p50_ms": _r(percentile(values, 50)),
        "p95_ms": _r(percentile(values, 95)),
        "max_ms": _r(values[-1]),
        "mean_ms": _r(statistics.fmean(values)),
    }


def ece(pairs: Sequence[tuple[float, bool]], bins: int = ECE_BINS) -> float | None:
    """(確信度, 当たったか) の組から ECE（等幅 bins）。空は None。"""
    if not pairs:
        return None
    total = 0.0
    for b in range(bins):
        lo, hi = b / bins, (b + 1) / bins
        members = [(c, ok) for c, ok in pairs if (lo < c <= hi) or (b == 0 and c == 0.0)]
        if not members:
            continue
        conf = statistics.fmean(c for c, _ in members)
        acc = statistics.fmean(1.0 if ok else 0.0 for _, ok in members)
        total += abs(acc - conf) * len(members) / len(pairs)
    return round(total, 4)


# ---- L1 の呼び出し ----


@dataclasses.dataclass
class L1Run:
    latencies_ms: list[float] = dataclasses.field(default_factory=list)
    failures: dict[str, int] = dataclasses.field(default_factory=dict)
    models: dict[str, int] = dataclasses.field(default_factory=dict)  # 実際に答えたモデル
    warmup_ms: float | None = None
    warmup_failures: dict[str, int] = dataclasses.field(default_factory=dict)
    attempts: int = 0
    timeout_ms: float | None = None

    def report(self) -> dict[str, object]:
        out = summarize_ms(self.latencies_ms)
        out["attempts"] = self.attempts
        out["answered_ratio"] = (
            _r(len(self.latencies_ms) / self.attempts, 3) if self.attempts else None
        )
        # 失敗をタイムアウトの長さで混ぜた p95（成功だけの p95 は遅い呼び出しが落ちて低く見える）
        if self.timeout_ms is not None and self.attempts:
            padded = [*self.latencies_ms, *[self.timeout_ms] * sum(self.failures.values())]
            out["p95_ms_failures_as_timeout"] = _r(percentile(sorted(padded), 95))
        out["failed"] = sum(self.failures.values())
        out["failures"] = dict(sorted(self.failures.items()))
        out["answered_by"] = dict(sorted(self.models.items()))
        out["warmup_ms"] = None if self.warmup_ms is None else _r(self.warmup_ms)
        out["warmup_failures"] = dict(sorted(self.warmup_failures.items()))
        return out


async def _call(client: JudgeClient, request: JudgeRequest) -> tuple[float, str | None, str | None]:
    """(ms, 答えたモデル, 失敗の理由)。"""
    t0 = time.perf_counter()
    try:
        answer = await client.judge(request)
    except L1Unavailable as exc:
        return (time.perf_counter() - t0) * 1000.0, None, exc.reason
    return (time.perf_counter() - t0) * 1000.0, answer.model, None


async def _warm_up(
    run: L1Run, client: JudgeClient, requests: Sequence[JudgeRequest], attempts: int
) -> None:
    """最初の成功まで最大 attempts 回。モデルのロードは 800 ms で終わらないので、
    長いタイムアウトのクライアントで呼ぶ。失敗の理由は残す。"""
    for i in range(attempts):
        ms, _, reason = await _call(client, requests[i % len(requests)])
        if reason is None:
            run.warmup_ms = ms
            return
        run.warmup_failures[reason] = run.warmup_failures.get(reason, 0) + 1


async def run_l1(
    client: JudgeClient,
    requests: Sequence[JudgeRequest],
    n: int,
    warmup: int,
    interval_ms: float = 0.0,
    warmup_client: JudgeClient | None = None,
    timeout_ms: float | None = None,
) -> L1Run:
    """warmup（別に計る）→ n 回。p50/p95 は成功した呼び出しだけ。"""
    run = L1Run(timeout_ms=timeout_ms)
    await _warm_up(run, warmup_client or client, requests, warmup)
    for i in range(n):
        started = time.perf_counter()
        ms, model, reason = await _call(client, requests[i % len(requests)])
        run.attempts += 1
        if reason is None and model is not None:
            run.latencies_ms.append(ms)
            run.models[model] = run.models.get(model, 0) + 1
        else:
            key = reason or "unknown"
            run.failures[key] = run.failures.get(key, 0) + 1
        wait = interval_ms / 1000.0 - (time.perf_counter() - started)
        if wait > 0:
            await asyncio.sleep(wait)
    return run


# ---- YOLO（L0）----

Snapshot = tuple[float, int, int]  # (時刻, 推論の回数, 例外の回数)


class YoloLoop:
    """検出器を別スレッドで回し続ける。`snapshot()` の差で区間の fps を測る。"""

    def __init__(self, detector: Detector, frames: Sequence[np.ndarray]) -> None:
        self._detector = detector
        self._frames = frames
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="bench-yolo", daemon=True)
        self._lock = threading.Lock()
        self._count = 0
        self._errors = 0
        self.last_error: str | None = None

    def _run(self) -> None:
        i = 0
        while not self._stop.is_set():
            try:
                self._detector.detect(self._frames[i % len(self._frames)])
            except Exception as exc:  # noqa: BLE001  計測を止めない。件数と型だけ残す
                with self._lock:
                    self._errors += 1
                    self.last_error = type(exc).__name__
                time.sleep(0.001)
            else:
                with self._lock:
                    self._count += 1
            i += 1

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._thread.join(timeout=10)

    def snapshot(self) -> Snapshot:
        with self._lock:
            return time.perf_counter(), self._count, self._errors

    async def wait_ready(self, frames: int = READY_FRAMES, timeout_s: float = 60.0) -> bool:
        """最初の数回（CoreML のコンパイル・ウォームアップ）が済むまで待つ。"""
        deadline = time.perf_counter() + timeout_s
        while time.perf_counter() < deadline:
            if self.snapshot()[1] >= frames:
                return True
            await asyncio.sleep(0.02)
        return False


def fps_between(a: Snapshot, b: Snapshot) -> float:
    dt = b[0] - a[0]
    return (b[1] - a[1]) / dt if dt > 0 else math.nan


def make_frames(seed: int) -> list[np.ndarray]:
    rng = np.random.default_rng(seed)
    return [rng.integers(0, 256, FRAME_SHAPE, dtype=np.uint8) for _ in range(FRAME_COUNT)]


# ---- 計測の本体 ----


@dataclasses.dataclass(frozen=True)
class Bench:
    base_url: str
    timeout_ms: int
    n: int = 100
    warmup: int = 3
    interval_ms: float = 400.0  # 実行時の L1 は 2.5 Hz。0 は連続（最悪の場合）
    yolo_seconds: float = 10.0
    seed: int = 7
    target_fps: int = 10  # 実行時の L0 の目標（pipeline.target_fps）
    ready_timeout_s: float = 60.0  # YOLO の最初の数回（コンパイル）を待つ上限


def _fps_report(a: Snapshot, b: Snapshot, last_error: str | None) -> dict[str, object]:
    return {
        "fps": _r(fps_between(a, b), 2),
        "seconds": _r(b[0] - a[0], 2),
        "frames": b[1] - a[1],
        "errors": b[2] - a[2],
        "last_error": last_error,
    }


async def run_bench(
    bench: Bench,
    client: JudgeClient,
    requests: Sequence[JudgeRequest],
    detector: Detector | None,
    warmup_client: JudgeClient | None = None,
) -> dict[str, object]:
    report: dict[str, object] = {"mode": "bench"}
    alone = await run_l1(
        client, requests, bench.n, bench.warmup, bench.interval_ms, warmup_client, bench.timeout_ms
    )
    report["l1_alone"] = alone.report()
    if detector is None:
        report["verdict"] = {"fps_drop_limit_pct": FPS_DROP_LIMIT_PCT, "fps_drop_pct": None}
        return report
    loop = YoloLoop(detector, make_frames(bench.seed))
    loop.start()
    try:
        ready = await loop.wait_ready(timeout_s=bench.ready_timeout_s)
        a = loop.snapshot()
        await asyncio.sleep(bench.yolo_seconds)
        b = loop.snapshot()
        both = await run_l1(
            client, requests, bench.n, 0, bench.interval_ms, timeout_ms=bench.timeout_ms
        )
        c = loop.snapshot()
    finally:
        loop.stop()
    alone_report = _fps_report(a, b, loop.last_error)
    with_report = _fps_report(b, c, loop.last_error)
    fps_alone, fps_with = fps_between(a, b), fps_between(b, c)
    drop = (fps_alone - fps_with) / fps_alone * 100.0 if fps_alone > 0 else math.nan
    enough = len(both.latencies_ms) >= bench.n * MIN_ANSWERED_RATIO
    errors = int(alone_report["errors"]) + int(with_report["errors"])  # type: ignore[call-overload]
    reason = None
    if not ready:
        reason = "yolo_not_ready"
    elif errors:
        reason = "yolo_errors"  # 推論が例外を出した窓の fps は処理能力ではない
    elif not enough:
        # L1 が落ちていると YOLO は負荷なしで回り、低下率が小さく出て合格に見える
        reason = "l1_failed_during_overlap"
    valid = reason is None
    report["l0_alone"] = alone_report
    report["l0_with_l1"] = with_report
    report["l1_with_yolo"] = both.report()
    report["verdict"] = {
        "valid": valid,
        "invalid_reason": reason,
        "fps_drop_pct": _r(drop),
        "fps_drop_limit_pct": FPS_DROP_LIMIT_PCT,
        "fps_drop_ok": bool(valid and math.isfinite(drop) and drop <= FPS_DROP_LIMIT_PCT),
        "target_fps": bench.target_fps,
        "l0_meets_target_fps": bool(math.isfinite(fps_with) and fps_with >= bench.target_fps),
        "l0_errors": errors,
    }
    return report


# ---- YOLO 単独（L1 なし。edge-run）----


def run_yolo_alone(
    detector: Detector,
    frames: Sequence[np.ndarray],
    seconds: float,
    *,
    target_fps: int = 10,
    ready_frames: int = READY_FRAMES,
    clock: Callable[[], float] = time.perf_counter,
) -> dict[str, object]:
    """検出器を同じスレッドで休みなく回し、1 回ごとの ms と fps を出す。L1 には触れない。

    最初の ready_frames 回（CoreML のコンパイル）は測らず、1 回目を first_ms に残す。
    例外が 1 回でもあれば判定は無効（例外の窓の速さは処理能力ではない）。
    """
    errors = 0
    last_error: str | None = None
    first_ms: float | None = None
    warm_ok = 0
    i = 0

    def once() -> float | None:
        nonlocal errors, last_error, i
        started = clock()
        try:
            detector.detect(frames[i % len(frames)])
        except Exception as exc:  # noqa: BLE001  計測を止めない。件数と型だけ残す
            errors += 1
            last_error = type(exc).__name__
            return None
        finally:
            i += 1
        return (clock() - started) * 1000.0

    for k in range(ready_frames):
        ms = once()
        if k == 0 and ms is not None:
            first_ms = ms
        warm_ok += ms is not None
    samples: list[float] = []
    started = clock()
    elapsed = 0.0
    if warm_ok:
        while elapsed < seconds:
            ms = once()
            if ms is not None:
                samples.append(ms)
            elapsed = clock() - started
    fps = len(samples) / elapsed if elapsed > 0 else math.nan
    infer = summarize_ms(samples)
    reason = None
    if not warm_ok:
        reason = "yolo_not_ready"
    elif errors:
        reason = "yolo_errors"
    elif not samples:
        reason = "no_frames"
    valid = reason is None
    p95 = infer["p95_ms"]
    meets_fps = bool(valid and math.isfinite(fps) and fps >= target_fps)
    within_budget = bool(valid and p95 is not None and p95 <= INFER_BUDGET_MS)  # type: ignore[operator]
    return {
        "mode": "yolo",
        "l0_alone": {
            "fps": _r(fps, 2),
            "seconds": _r(elapsed, 2),
            "frames": len(samples),
            "errors": errors,
            "last_error": last_error,
            "first_ms": _r(first_ms) if first_ms is not None else None,
            "infer": infer,
        },
        "verdict": {
            "valid": valid,
            "invalid_reason": reason,
            "target_fps": target_fps,
            "l0_meets_target_fps": meets_fps,
            "infer_budget_ms": INFER_BUDGET_MS,
            "infer_p95_within_budget": within_budget,
            "infer_target_ms": INFER_TARGET_MS,
            "infer_p95_within_target": bool(
                valid and p95 is not None and p95 <= INFER_TARGET_MS  # type: ignore[operator]
            ),
            # 合否（exit 4）: 予算 100 ms と目標の fps。50 ms は目標で、超えても不合格にしない
            "meets_ch6": meets_fps and within_budget,
            "note": "推論だけの参考値。入力は乱数画像（鹿が写らず後処理が軽い）",
        },
    }


# ---- 比較（Step 6 の入口）----


def rule_answer(request: dict[str, object]) -> dict[str, object]:
    """閾値ルールのみ（L1 なし）の予測。赤の候補の場面だけを流すので alert_level は danger、
    ほかは L0 の track（最後の点）だけから決める。正解ラベルは見ない。"""
    state = request["state"]
    points = state["track"]  # type: ignore[index]
    last = points[-1] if points else {}
    lane = last.get("pos") == "lane"
    still = abs(float(last.get("lateralMps", 0.0))) < STILL_MPS
    return {
        "alert_level": ("danger", 1.0),
        "on_roadway": (lane, 1.0),
        "static_shoulder": (bool(last) and not lane and still, 1.0),
        "false_positive": (False, 1.0),
    }


def _score(
    rows: Sequence[tuple[dict[str, object], dict[str, tuple[object, float]]]], total: int
) -> dict[str, object]:
    """accuracy は答えた分だけ、accuracy_all は失敗を不正解として全シナリオで割る。
    遅い・落ちる系ほど難しい例が落ちて accuracy が上がるので、coverage を並べる。"""
    out: dict[str, object] = {}
    for q in QUESTIONS:
        pairs = [(conf, pred == labels[q]) for labels, preds in rows for pred, conf in [preds[q]]]
        right = sum(ok for _, ok in pairs)
        out[q] = {
            "n": len(pairs),
            "coverage": None if not total else round(len(pairs) / total, 4),
            "accuracy": None if not pairs else round(right / len(pairs), 4),
            "accuracy_all": None if not total else round(right / total, 4),
            "ece": ece(pairs),
        }
    return out


def _predictions(answer: object) -> dict[str, tuple[object, float]]:
    levels: dict[str, float] = answer.alert_level  # type: ignore[attr-defined]
    top = max(levels, key=lambda k: levels[k])
    preds: dict[str, tuple[object, float]] = {"alert_level": (top, levels[top])}
    for q in NOUL_QUESTIONS:
        p = float(getattr(answer, q))  # noul は「はい」の確率
        preds[q] = (p >= 0.5, max(p, 1.0 - p))
    return preds


async def run_compare(
    examples: Sequence[dict[str, object]],
    systems: Sequence[str],
    client: JudgeClient,
    interval_ms: float = 0.0,
    warmup: int = 3,
    warmup_client: JudgeClient | None = None,
    timeout_ms: float | None = None,
) -> dict[str, object]:
    """examples は export_l1_labels の行。systems は local-jev のモデル名。"""
    total = len(examples)
    out: dict[str, object] = {"mode": "compare", "scenarios": total}
    results: dict[str, object] = {}
    rule_rows = [(ex["labels"], rule_answer(ex["request"])) for ex in examples]  # type: ignore[arg-type]
    results["rule"] = {
        "questions": _score(rule_rows, total),
        "latency": summarize_ms([]),
        "valid": True,
        "invalid_reason": None,
    }
    for name in systems:
        reqs = [{**ex["request"], "model": name} for ex in examples]  # type: ignore[dict-item]
        parsed = [JudgeRequest.model_validate(r) for r in reqs]
        run = L1Run(timeout_ms=timeout_ms)
        await _warm_up(run, warmup_client or client, parsed, warmup)  # モデルのロード
        rows = []
        for i, req in enumerate(parsed):
            started = time.perf_counter()
            run.attempts += 1
            try:
                answer = await client.judge(req)
            except L1Unavailable as exc:
                run.failures[exc.reason] = run.failures.get(exc.reason, 0) + 1
            else:
                run.latencies_ms.append((time.perf_counter() - started) * 1000.0)
                run.models[answer.model] = run.models.get(answer.model, 0) + 1
                rows.append((examples[i]["labels"], _predictions(answer)))
            wait = interval_ms / 1000.0 - (time.perf_counter() - started)
            if wait > 0:
                await asyncio.sleep(wait)
        # 要求したモデルと違うモデルが答えた系は、数字を載せても別のモデルのものになる
        mismatch = sorted(set(run.models) - {name})
        reason = None
        if mismatch:
            reason = f"answered_by_other_model: {mismatch}"
        elif not rows:
            reason = "no_answers"
        results[name] = {
            "questions": _score(rows, total),
            "latency": run.report(),
            "valid": reason is None,
            "invalid_reason": reason,
        }
    out["systems"] = results
    return out


# ---- 環境・表・CLI ----


def _cpu_brand() -> str | None:
    try:
        done = subprocess.run(
            ["/usr/sbin/sysctl", "-n", "machdep.cpu.brand_string"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return done.stdout.strip() or None


def _version(dist: str) -> str | None:
    try:
        return importlib.metadata.version(dist)
    except importlib.metadata.PackageNotFoundError:
        return None


def environment() -> dict[str, object]:
    return {
        "cpu": _cpu_brand(),
        "platform": platform.platform(),
        "machine": platform.machine(),
        "python": platform.python_version(),
        "packages": {
            d: _version(d)
            for d in (
                "numpy",
                "typesafe-sdk",
                "coremltools",
                "ultralytics",
                "mlx",
                "antler-detector",
            )
        },
    }


def render_table(report: dict[str, object]) -> str:
    """貼り付け用の Markdown の要約。"""
    lines: list[str] = []

    def row(label: str, r: dict[str, object]) -> str:
        return (
            f"| {label} | {r.get('n')} | {r.get('p50_ms')} | {r.get('p95_ms')} "
            f"| {r.get('max_ms')} | {r.get('failed', 0)} | {r.get('warmup_ms')} |"
        )

    if report["mode"] == "yolo":
        alone, v = report["l0_alone"], report["verdict"]
        inf = alone["infer"]  # type: ignore[index]
        lines += [
            "| L0（YOLO 単独） | fps | n | p50 ms | p95 ms | max ms | 初回 ms | 例外 |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |",
            f"| L1 なし | {alone['fps']} | {inf['n']} | {inf['p50_ms']} | {inf['p95_ms']} "  # type: ignore[index]
            f"| {inf['max_ms']} | {alone['first_ms']} | {alone['errors']} |",  # type: ignore[index]
            "",
        ]
        if v["valid"]:  # type: ignore[index]
            within = {
                k: "以内" if v[k] else "超過"
                for k in (
                    "infer_p95_within_budget",  # type: ignore[index]
                    "infer_p95_within_target",
                )
            }
            lines.append(
                f"{'合格' if v['meets_ch6'] else '不合格'}（推論だけ・乱数画像の参考値）。"  # type: ignore[index]
                f"推論 p95 {inf['p95_ms']} ms: 予算 {v['infer_budget_ms']:g} ms "  # type: ignore[index]
                f"{within['infer_p95_within_budget']}・目標 {v['infer_target_ms']:g} ms "  # type: ignore[index]
                f"{within['infer_p95_within_target']}。目標 {v['target_fps']} fps を"  # type: ignore[index]
                f"{'保てる' if v['l0_meets_target_fps'] else '保てない'}"  # type: ignore[index]
            )
        else:
            lines.append(f"判定できない: {v['invalid_reason']}（{alone['last_error']}）")  # type: ignore[index]
    elif report["mode"] == "bench":
        lines += [
            "| L1 | 成功 n | p50 ms | p95 ms | max ms | 失敗 | warmup ms |",
            "| --- | --- | --- | --- | --- | --- | --- |",
            row("YOLO なし", report["l1_alone"]),  # type: ignore[arg-type]
        ]
        if "l1_with_yolo" in report:
            lines.append(row("YOLO と併走", report["l1_with_yolo"]))  # type: ignore[arg-type]
            alone, with_l1 = report["l0_alone"], report["l0_with_l1"]
            v = report["verdict"]
            lines += [
                "",
                "| L0 | fps | 秒 | 例外 |",
                "| --- | --- | --- | --- |",
                f"| L1 なし | {alone['fps']} | {alone['seconds']} | {alone['errors']} |",  # type: ignore[index]
                f"| L1 と併走 | {with_l1['fps']} | {with_l1['seconds']} | {with_l1['errors']} |",  # type: ignore[index]
                "",
            ]
            if v["valid"]:  # type: ignore[index]
                lines.append(
                    f"fps の低下 {v['fps_drop_pct']}%（上限 {FPS_DROP_LIMIT_PCT:g}%）: "  # type: ignore[index]
                    f"{'合格' if v['fps_drop_ok'] else '不合格'}。"  # type: ignore[index]
                    f"目標 {v['target_fps']} fps を"  # type: ignore[index]
                    f"{'保てる' if v['l0_meets_target_fps'] else '保てない'}"  # type: ignore[index]
                )
            else:
                lines.append(f"判定できない: {v['invalid_reason']}")  # type: ignore[index]
    else:
        lines += [
            "| system | 問 | 正解率 | 失敗を不正解にした正解率 | 回答率 | ECE | p50 ms | p95 ms |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
        for name, res in report["systems"].items():  # type: ignore[attr-defined]
            lat = res["latency"]
            flag = "" if res["valid"] else f"（無効: {res['invalid_reason']}）"
            for q, s in res["questions"].items():
                lines.append(
                    f"| {name}{flag} | {q} | {s['accuracy']} | {s['accuracy_all']} "
                    f"| {s['coverage']} | {s['ece']} | {lat.get('p50_ms')} | {lat.get('p95_ms')} |"
                )
    return "\n".join(lines)


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python scripts/bench_l1.py", description=__doc__)
    p.add_argument("--n", type=int, default=100, help="L1 を呼ぶ回数（既定 100）")
    p.add_argument(
        "--warmup",
        type=int,
        default=3,
        help="最初の成功までの最大の試行回数（計測に入れない。モデルのロード。既定 3）",
    )
    p.add_argument(
        "--warmup-timeout-ms",
        type=int,
        default=120_000,
        help="warmup だけのタイムアウト（既定 120000。初回はモデルを読み込む）",
    )
    p.add_argument("--config", type=Path, help="edge の設定 TOML（接続先・compute units に使う）")
    p.add_argument("--base-url", help="local-jev の URL（既定: 環境変数 TYPESAFE_BASE_URL か設定）")
    p.add_argument(
        "--timeout-ms", type=int, help="1 回のタイムアウト（既定: 設定の l1.timeout_ms）"
    )
    p.add_argument("--interval-ms", type=float, default=400.0, help="呼び出しの間隔（0 で連続）")
    p.add_argument("--model", type=Path, help="YOLO の .mlpackage（付けると併走を測る）")
    p.add_argument(
        "--compute-units",
        choices=sorted(COMPUTE_UNIT_NAMES),
        help="YOLO の compute units（既定: 設定の coreml.compute_units = cpu_and_ne）",
    )
    p.add_argument("--yolo-seconds", type=float, default=10.0, help="YOLO 単独の計測の秒数")
    p.add_argument(
        "--no-l1",
        action="store_true",
        help="L1 を呼ばずに YOLO だけを測る（--model が要る。local-jev が無くてよい）",
    )
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--out", type=Path, help="JSON の書き出し先")
    cmp_ = p.add_argument_group("比較（Step 6）")
    cmp_.add_argument("--compare", action="store_true", help="正解付きシナリオで比較する")
    cmp_.add_argument("--labels", type=Path, help="export_l1_labels.py の JSONL（無ければ合成）")
    cmp_.add_argument("--scenarios", type=int, default=200)
    cmp_.add_argument(
        "--systems", nargs="+", default=["llm-qwen2.5-1.5b"], help="local-jev のモデル名"
    )
    return p


def _fail(reason: str, code: int) -> int:
    sys.stderr.write(f"bench_l1: {reason}\n")
    return code


def _load_examples(path: Path) -> list[dict[str, object]]:
    rows = []
    for no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            msg = f"{path.name} {no} 行目: JSON ではない"
            raise ValueError(msg) from exc
        if not (isinstance(row, dict) and {"request", "labels"} <= set(row)):
            msg = f"{path.name} {no} 行目: request と labels が要る"
            raise ValueError(msg)
        if not isinstance(row["labels"], dict) or not set(QUESTIONS) <= set(row["labels"]):
            msg = f"{path.name} {no} 行目: labels に {list(QUESTIONS)} が要る"
            raise ValueError(msg)
        rows.append(row)
    if not rows:
        msg = f"{path.name}: 行が無い"
        raise ValueError(msg)
    return rows


def _synthetic_requests(
    loader: Callable[[int, int], list[dict[str, object]]] | None, n: int, seed: int
) -> list[dict[str, object]]:
    if loader is None:
        msg = "合成の例を作る入口が無い（scripts/bench_l1.py から呼ぶか --labels を付ける）"
        raise ValueError(msg)
    rows = loader(n, seed)
    if not rows:
        msg = "合成の例が 0 件"
        raise ValueError(msg)
    return rows


def _detector(config: Config, model: Path) -> Detector:
    from detector.l0.coreml import load_coreml_detector

    infer = dataclasses.replace(config.infer, model_path=str(model))
    return load_coreml_detector(dataclasses.replace(config, infer=infer))


def _problem(report: dict[str, object]) -> str | None:
    """結果が信用できない理由（あれば exit 3）。JSON は出したうえで知らせる。"""
    if report["mode"] == "yolo":
        v = report["verdict"]
        if v["valid"]:  # type: ignore[index]
            return None
        return f"YOLO 単独の判定が無効: {v['invalid_reason']}"  # type: ignore[index]
    if report["mode"] == "bench":
        alone = report["l1_alone"]
        if int(alone["n"]) == 0:  # type: ignore[index]
            return "L1 から 1 件も答えが来ない（local-jev は起動済みか）"
        if (alone["answered_ratio"] or 0) < MIN_ANSWERED_RATIO:  # type: ignore[index]
            return f"L1 の回答率が低い（{alone['answered_ratio']}）。p95 は成功分だけで低く見える"  # type: ignore[index]
        if alone["warmup_ms"] is None and alone["warmup_failures"]:  # type: ignore[index]
            return "warmup が 1 度も成功していない（モデルを読み込めていない）"
        verdict = report["verdict"]
        if verdict.get("valid") is False:  # type: ignore[attr-defined]
            return f"併走の判定が無効: {verdict['invalid_reason']}"  # type: ignore[index]
        return None
    bad = [k for k, s in report["systems"].items() if not s["valid"]]  # type: ignore[attr-defined]
    return f"無効な系がある（JSON の invalid_reason）: {bad}" if bad else None


def _config_for(args: argparse.Namespace) -> Config:
    config = load_config(args.config) if args.config else Config()
    if args.compute_units:
        config = dataclasses.replace(
            config, coreml=dataclasses.replace(config.coreml, compute_units=args.compute_units)
        )
    return config


def _main_yolo(
    args: argparse.Namespace, detector_factory: Callable[[Config, Path], Detector]
) -> int:
    """`--no-l1`: L1 のクライアント・合成の例を作らず、YOLO だけを測る（edge-run R7）。"""
    if args.compare:
        return _fail("--no-l1 と --compare は一緒に使えない", EXIT_INPUT)
    if not args.model:
        return _fail("--no-l1 には --model（.mlpackage）が要る", EXIT_INPUT)
    try:
        config = _config_for(args)
        detector = detector_factory(config, args.model)
    except (ConfigError, ValueError, OSError, RuntimeError) as exc:
        return _fail(f"{type(exc).__name__}: {exc}", EXIT_INPUT)
    started = datetime.now(UTC)
    report = run_yolo_alone(
        detector, make_frames(args.seed), args.yolo_seconds, target_fps=config.pipeline.target_fps
    )
    report = {
        "schema": SCHEMA,
        "generated_at": started.isoformat(timespec="seconds"),
        "environment": environment(),
        "params": {
            "no_l1": True,
            "yolo_seconds": args.yolo_seconds,
            "model": args.model.name,
            "compute_units": config.coreml.compute_units,
            "seed": args.seed,
        },
        **report,
    }
    code = _emit(report, args.out)
    if code != EXIT_OK:
        return code
    problem = _problem(report)
    if problem is not None:
        return _fail(problem, EXIT_UNREACHABLE)
    if not report["verdict"]["meets_ch6"]:  # type: ignore[index]
        return _fail("ch6 の予算（推論 p95 100 ms）か目標の fps を満たさない", EXIT_SLOW)
    return EXIT_OK


def _emit(report: dict[str, object], out: Path | None) -> int:
    text = json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False)
    sys.stdout.write(text + "\n\n" + render_table(report) + "\n")  # 先に出す(計測は再現できない)
    if out:
        try:
            out.write_text(text + "\n", encoding="utf-8")
        except OSError as exc:
            return _fail(f"--out に書けない（{type(exc).__name__}）。上の出力を貼る", EXIT_INPUT)
    return EXIT_OK


def main(
    argv: Sequence[str] | None = None,
    *,
    examples_loader: Callable[[int, int], list[dict[str, object]]] | None = None,
    client_factory: Callable[[str, int], JudgeClient] = make_client,
    detector_factory: Callable[[Config, Path], Detector] = _detector,
) -> int:
    """examples_loader(n, seed) は合成の例（export_l1_labels の行）を返す。"""
    args = _parser().parse_args(argv)
    if (
        args.n < 1
        or args.scenarios < 1
        or args.warmup < 0
        or args.interval_ms < 0
        or args.yolo_seconds <= 0
    ):
        return _fail(
            "--n・--scenarios は 1 以上、--warmup・--interval-ms は 0 以上、--yolo-seconds は正", 2
        )
    if args.no_l1:
        return _main_yolo(args, detector_factory)
    try:
        config = _config_for(args)
        base_url = args.base_url or resolve_base_url(config.l1.base_url)
        timeout_ms = args.timeout_ms or config.l1.timeout_ms
        examples = (
            _load_examples(args.labels)
            if args.labels
            else _synthetic_requests(examples_loader, args.scenarios, args.seed)
        )
        requests = [JudgeRequest.model_validate(ex["request"]) for ex in examples]
        detector = detector_factory(config, args.model) if args.model else None
        client = client_factory(base_url, timeout_ms)
        warmup_client = client_factory(base_url, max(args.warmup_timeout_ms, timeout_ms))
    except ValidationError as exc:  # 文字列に請求の中身(入力値)が出るので件数だけ
        return _fail(
            f"ValidationError: {exc.error_count()} 件（入力の形が JudgeRequest と違う）", 2
        )
    except (ConfigError, L1Unavailable, ValueError, OSError, RuntimeError) as exc:
        return _fail(f"{type(exc).__name__}: {exc}", EXIT_INPUT)
    started = datetime.now(UTC)

    async def go() -> dict[str, object]:
        try:
            if args.compare:
                return await run_compare(
                    examples,
                    args.systems,
                    client,
                    args.interval_ms,
                    args.warmup,
                    warmup_client,
                    timeout_ms,
                )
            bench = Bench(
                base_url,
                timeout_ms,
                args.n,
                args.warmup,
                args.interval_ms,
                args.yolo_seconds,
                args.seed,
                config.pipeline.target_fps,
            )
            return await run_bench(bench, client, requests, detector, warmup_client)
        finally:
            for c in (client, warmup_client):
                close = getattr(c, "aclose", None)
                if close:
                    await close()

    report = asyncio.run(go())
    report = {
        "schema": SCHEMA,
        "generated_at": started.isoformat(timespec="seconds"),
        "environment": environment(),
        "params": {
            "n": args.n,
            "warmup": args.warmup,
            "interval_ms": args.interval_ms,
            "timeout_ms": timeout_ms,
            "warmup_timeout_ms": max(args.warmup_timeout_ms, timeout_ms),
            "yolo_seconds": args.yolo_seconds,
            "base_url_host": base_url.split("//", 1)[-1],
            "model": args.model.name if args.model else None,
            "compute_units": config.coreml.compute_units,
            "seed": args.seed,
        },
        **report,
    }
    code = _emit(report, args.out)
    if code != EXIT_OK:
        return code
    problem = _problem(report)
    return EXIT_OK if problem is None else _fail(problem, EXIT_UNREACHABLE)
