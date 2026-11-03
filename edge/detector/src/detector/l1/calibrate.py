"""L1 の温度の学習（B2-7）: 生の確率と正解から質問ごとの T を学び、calibration.json を書く。

docs/specs/edge-l1-calibration R7〜R10。当て方は edge-l1 の `Calibration`（読み込み側）を
そのまま使い、書いたファイルは `load_calibration` で読み戻してから置き換える。

**疑わしいときは書かない**: calibration.json が無ければ edge-l1 は降格しない（安全側）。
件数不足・片クラス・分離できるデータ（T < 0.25）・合成のデータ・検証用で危険な鹿
（正解 danger）を降格する温度は書かない。

    python -m detector.l1.calibrate fit ANSWERS.jsonl --out calibration.json [--report r.json]
    python -m detector.l1.calibrate evaluate ANSWERS.jsonl --calibration calibration.json

答えのファイル（JSONL、1 行 1 件）:
    {"id", "model", "probs": Capture.l1Probs と同じ形,
     "labels": {alert_level, on_roadway, static_shoulder, false_positive},
     "meta": {"traceId", "source", "pattern"?, ...}}
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import math
import sys
from dataclasses import dataclass, replace
from pathlib import Path
from typing import TYPE_CHECKING, Final

import numpy as np

from detector.config import L1Config
from detector.fusion import conclude
from detector.l1.calibration import (
    EPS,
    MAX_T,
    MIN_T,
    MODEL_ALIASES,
    VERSION,
    Calibration,
    load_calibration,
)
from detector.l1.client import L1Answer
from detector.l1.questions import ALERT_LEVELS, NOUL_IDS, QUESTION_IDS

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable, Sequence

__all__ = [
    "CalibrationDataError",
    "CalibrationRefused",
    "CalibrationWriteError",
    "FitResult",
    "Labels",
    "Sample",
    "calibrate",
    "ece",
    "evaluate",
    "fit_temperature",
    "fit_temperatures",
    "is_validation",
    "load_samples",
    "main",
    "nll",
    "override_metrics",
    "parse_samples",
    "sample_to_row",
    "wilson_lower",
    "write_calibration",
]

logger = logging.getLogger("detector.l1")

MIN_SAFE_T: Final = 0.25  # 生の 0.63 が校正後 0.9 になる鋭さ。これより鋭い T は書かない（R7 の 3）
MIN_CLASS: Final = 10  # noul の正・負、alert_level の各クラスに要る件数（学習用）
MIN_CHOICE_CLASSES: Final = 2  # alert_level で MIN_CLASS 件以上のクラスの数（none は正解に出ない）
HOLDOUT_RANGE: Final = (0.1, 0.5)
MIN_VALIDATION: Final = 30  # 検証用に要る別々のトレースの数
DEFAULT_MIN_SAMPLES: Final = 100  # 学習用に要る別々のトレースの数（目標 100〜300 の下限）
DEFAULT_HOLDOUT: Final = 0.3
ECE_BINS: Final = 10
SEARCH_STEPS: Final = 120  # log β の黄金分割探索の回数（区間は 0.618^120 倍に縮む）
DIGITS: Final = 6
BOUND_RTOL: Final = 1e-3
WILSON_Z: Final = 1.96
OVERRIDE_CONF_RANGE: Final = (0.9, 1.0)  # B2-5 の MUST（0.9 より下げられない。L1Config と同じ）
SYNTHETIC: Final = "synthetic"
EXIT_OK, EXIT_REFUSED, EXIT_INPUT = 0, 1, 2

_GOLDEN: Final = (math.sqrt(5.0) - 1.0) / 2.0


class CalibrationDataError(Exception):
    """答えのファイルが読めない・形が違う（exit 2）。行番号と欄の名前を持つ。"""


class CalibrationRefused(Exception):
    """件数・偏り・検証の理由で書かない（exit 1）。"""


class CalibrationWriteError(Exception):
    """書き出しの検証・置き換えに失敗した（exit 2）。前のファイルは残っている。"""


@dataclass(frozen=True)
class Labels:
    alert_level: str
    on_roadway: bool
    static_shoulder: bool
    false_positive: bool

    def noul(self, qid: str) -> bool:
        return bool(getattr(self, qid))

    def to_json(self) -> dict[str, object]:
        return {
            "alert_level": self.alert_level,
            "on_roadway": self.on_roadway,
            "static_shoulder": self.static_shoulder,
            "false_positive": self.false_positive,
        }


@dataclass(frozen=True)
class Sample:
    """答えのファイルの 1 行（L1 の生の確率と正解）。"""

    id: str
    answer: L1Answer
    labels: Labels
    trace_id: str
    source: str
    pattern: str | None = None


# ---- 読み込み（R7 の検証。1 行でも違えば全体を拒否） ----


def _reject_constant(name: str) -> float:
    msg = f"JSON に {name} は書けない"
    raise ValueError(msg)


def _bad(line: int, field: str, why: str) -> CalibrationDataError:
    return CalibrationDataError(f"{line} 行目: {field}: {why}")


def _prob(value: object, line: int, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise _bad(line, field, "数ではない")
    p = float(value)
    if not (math.isfinite(p) and 0.0 <= p <= 1.0):
        raise _bad(line, field, "有限の 0〜1 ではない")
    return p


def _text(value: object, line: int, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise _bad(line, field, "空でない文字列ではない")
    return value


def _dict(value: object, line: int, field: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise _bad(line, field, "オブジェクトではない")
    return value


def _parse_row(raw: object, line: int) -> Sample:
    row = _dict(raw, line, "行")
    sid = _text(row.get("id"), line, "id")
    model = row.get("model")
    if not isinstance(model, str):
        raise _bad(line, "model", "文字列ではない")
    probs = _dict(row.get("probs"), line, "probs")
    levels_raw = _dict(probs.get("alert_level"), line, "probs.alert_level")
    if set(levels_raw) != set(ALERT_LEVELS):
        raise _bad(line, "probs.alert_level", f"選択肢が {', '.join(ALERT_LEVELS)} ではない")
    levels = {k: _prob(levels_raw[k], line, f"probs.alert_level.{k}") for k in ALERT_LEVELS}
    noul = {q: _prob(probs.get(q), line, f"probs.{q}") for q in NOUL_IDS}
    labels_raw = _dict(row.get("labels"), line, "labels")
    level = labels_raw.get("alert_level")
    if level not in ALERT_LEVELS:
        raise _bad(line, "labels.alert_level", "語彙の外")
    flags: dict[str, bool] = {}
    for q in NOUL_IDS:
        v = labels_raw.get(q)
        if not isinstance(v, bool):
            raise _bad(line, f"labels.{q}", "真偽値ではない")
        flags[q] = v
    meta = _dict(row.get("meta"), line, "meta")
    pattern = meta.get("pattern")
    if pattern is not None and not isinstance(pattern, str):
        raise _bad(line, "meta.pattern", "文字列か null ではない")
    return Sample(
        id=sid,
        answer=L1Answer(model=model, alert_level=levels, **noul),
        labels=Labels(alert_level=str(level), **flags),
        trace_id=_text(meta.get("traceId"), line, "meta.traceId"),
        source=_text(meta.get("source"), line, "meta.source"),
        pattern=pattern,
    )


def parse_samples(lines: Iterable[str]) -> list[Sample]:
    """JSONL の行から。空行は飛ばす。1 行でも違えば CalibrationDataError（行番号つき）。"""
    samples: list[Sample] = []
    seen: set[str] = set()
    for n, text in enumerate(lines, start=1):
        if not text.strip():
            continue
        try:
            raw = json.loads(text, parse_constant=_reject_constant)
        except (ValueError, RecursionError) as exc:
            raise _bad(n, "行", "JSON ではない") from exc
        sample = _parse_row(raw, n)
        if sample.id in seen:
            raise _bad(n, "id", "重複")
        seen.add(sample.id)
        samples.append(sample)
    if not samples:
        msg = "答えが 1 件も無い"
        raise CalibrationDataError(msg)
    return samples


def load_samples(path: Path) -> list[Sample]:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        msg = f"{path} を読めない（{type(exc).__name__}）"
        raise CalibrationDataError(msg) from exc
    return parse_samples(text.splitlines())


def sample_to_row(sample: Sample) -> dict[str, object]:
    """答えのファイルの 1 行（bench_l1.py などが書く形。parse_samples の逆）。"""
    a = sample.answer
    meta: dict[str, object] = {"traceId": sample.trace_id, "source": sample.source}
    if sample.pattern is not None:
        meta["pattern"] = sample.pattern
    return {
        "id": sample.id,
        "model": a.model,
        "probs": {
            "alert_level": {k: a.alert_level[k] for k in ALERT_LEVELS},
            "on_roadway": a.on_roadway,
            "static_shoulder": a.static_shoulder,
            "false_positive": a.false_positive,
        },
        "labels": sample.labels.to_json(),
        "meta": meta,
    }


# ---- 学習（NLL 最小。式は Calibration.noul / choice と同じ） ----


def _noul_arrays(qid: str, samples: Sequence[Sample]) -> tuple[np.ndarray, np.ndarray]:
    p = np.clip(np.array([getattr(s.answer, qid) for s in samples], dtype=float), EPS, 1.0 - EPS)
    y = np.array([s.labels.noul(qid) for s in samples], dtype=float)
    return np.log(p / (1.0 - p)), y


def _choice_arrays(samples: Sequence[Sample]) -> tuple[np.ndarray, np.ndarray]:
    probs = [[s.answer.alert_level[k] for k in ALERT_LEVELS] for s in samples]
    z = np.log(np.clip(np.array(probs, dtype=float), EPS, 1.0 - EPS))
    idx = np.array([ALERT_LEVELS.index(s.labels.alert_level) for s in samples], dtype=int)
    return z, idx


def _nll_fn(qid: str, samples: Sequence[Sample]) -> Callable[[float], float]:
    """β（= 1/T）→ 平均 NLL の関数。NLL は β について凸。"""
    if qid in NOUL_IDS:
        z, y = _noul_arrays(qid, samples)

        def noul(beta: float) -> float:
            s = beta * z
            return float(np.mean(np.logaddexp(0.0, s) - y * s))

        return noul
    z, idx = _choice_arrays(samples)
    rows = np.arange(len(idx))

    def choice(beta: float) -> float:
        s = beta * z
        top = s.max(axis=1)
        lse = top + np.log(np.exp(s - top[:, None]).sum(axis=1))
        return float(np.mean(lse - s[rows, idx]))

    return choice


def nll(qid: str, samples: Sequence[Sample], temperature: float) -> float:
    """平均 NLL（温度 T を当てた確率で）。"""
    fn = _nll_fn(qid, samples)
    return fn(1.0 / temperature)


def fit_temperature(qid: str, samples: Sequence[Sample]) -> float:
    """log β を [log(1/MAX_T), log(1/MIN_T)] で黄金分割探索し、NLL 最小の T を返す（6 桁）。"""
    if not samples:
        msg = f"{qid}: 答えが無い"
        raise CalibrationRefused(msg)
    fn = _nll_fn(qid, samples)
    lo, hi = math.log(1.0 / MAX_T), math.log(1.0 / MIN_T)
    a = hi - _GOLDEN * (hi - lo)
    b = lo + _GOLDEN * (hi - lo)
    fa, fb = fn(math.exp(a)), fn(math.exp(b))
    for _ in range(SEARCH_STEPS):
        if fa <= fb:
            hi, b, fb = b, a, fa
            a = hi - _GOLDEN * (hi - lo)
            fa = fn(math.exp(a))
        else:
            lo, a, fa = a, b, fb
            b = lo + _GOLDEN * (hi - lo)
            fb = fn(math.exp(b))
    t = 1.0 / math.exp((lo + hi) / 2.0)
    return round(min(MAX_T, max(MIN_T, t)), DIGITS)


def fit_temperatures(samples: Sequence[Sample]) -> dict[str, float]:
    return {q: fit_temperature(q, samples) for q in QUESTION_IDS}


# ---- 評価（R9） ----


def ece(confidences: Sequence[float], correct: Sequence[bool], bins: int = ECE_BINS) -> float:
    """等幅 bin の ECE（上位ラベル）。確信度 1.0 は最後の bin。"""
    n = len(confidences)
    if n == 0:
        return 0.0
    conf = np.asarray(confidences, dtype=float)
    hit = np.asarray(correct, dtype=float)
    which = np.minimum((conf * bins).astype(int), bins - 1)
    total = 0.0
    for b in range(bins):
        mask = which == b
        k = int(mask.sum())
        if k:
            total += k / n * abs(float(hit[mask].mean()) - float(conf[mask].mean()))
    return total


def _top(qid: str, answer: L1Answer, labels: Labels) -> tuple[float, bool]:
    if qid in NOUL_IDS:
        q = float(getattr(answer, qid))
        return max(q, 1.0 - q), (q >= 0.5) == labels.noul(qid)
    best = max(ALERT_LEVELS, key=lambda k: (answer.alert_level[k], -ALERT_LEVELS.index(k)))
    return answer.alert_level[best], best == labels.alert_level


def wilson_lower(hits: int, n: int, z: float = WILSON_Z) -> float | None:
    if n == 0:
        return None
    p = hits / n
    denom = 1.0 + z * z / n
    centre = p + z * z / (2 * n)
    margin = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return round((centre - margin) / denom, 4)


@dataclass(frozen=True)
class OverrideStats:
    """降格の指標（R9）。正しい降格 = 正解が danger でない答えの降格。"""

    downgraded: int
    right: int
    danger_downgraded: int
    danger_by_pattern: dict[str, int]
    none_over: int

    @property
    def precision(self) -> float | None:
        return round(self.right / self.downgraded, 4) if self.downgraded else None

    def to_json(self) -> dict[str, object]:
        return {
            "downgraded": self.downgraded,
            "precision": self.precision,
            "precisionWilsonLow": wilson_lower(self.right, self.downgraded),
            "dangerDowngraded": self.danger_downgraded,
            "dangerDowngradedByPattern": dict(sorted(self.danger_by_pattern.items())),
            "noneOver": self.none_over,
        }


def override_metrics(
    answers: Sequence[L1Answer], samples: Sequence[Sample], override_conf: float
) -> OverrideStats:
    """降格の判定は edge-l1 の fusion.conclude（理由があれば降格の候補）と同じ。

    fusion の条件 4（車線の上の鹿は alert_level では降格しない）は数えない（厳しい側に倒す）。
    """
    downgraded = right = danger = none_over = 0
    by_pattern: dict[str, int] = {}
    for answer, sample in zip(answers, samples, strict=True):
        if answer.alert_level["none"] >= override_conf:
            none_over += 1
        _, _, reason = conclude(answer.alert_level, answer.false_positive, override_conf)
        if reason is None:
            continue
        downgraded += 1
        if sample.labels.alert_level != "danger":
            right += 1
        else:
            danger += 1
            key = sample.pattern or "unknown"
            by_pattern[key] = by_pattern.get(key, 0) + 1
    return OverrideStats(downgraded, right, danger, by_pattern, none_over)


def _applied(samples: Sequence[Sample], calibration: Calibration | None) -> list[Sample]:
    """校正を当てた答え（答えたモデルと合うときだけ当てる。実行時と同じ）。"""
    return [
        replace(s, answer=calibration.apply(s.answer))
        if calibration is not None and calibration.matches(s.answer.model)
        else s
        for s in samples
    ]


def evaluate(
    samples: Sequence[Sample], calibration: Calibration | None, override_conf: float
) -> dict[str, object]:
    """問ごとの NLL・ECE と降格の指標。"""
    used = _applied(samples, calibration)
    questions: dict[str, object] = {}
    for q in QUESTION_IDS:
        tops = [_top(q, s.answer, s.labels) for s in used]
        questions[q] = {
            "n": len(used),
            "nll": round(nll(q, used, 1.0), 6),
            "ece": round(ece([c for c, _ in tops], [h for _, h in tops]), 6),
        }
    applied = sum(1 for s, u in zip(samples, used, strict=True) if s is not u)
    stats = override_metrics([s.answer for s in used], used, override_conf)
    return {
        "n": len(used),
        "applied": applied,
        "questions": questions,
        "override": stats.to_json(),
    }


# ---- 学習の判定（R7） ----


def is_validation(trace_id: str, holdout: float) -> bool:
    """sha256(traceId) の先頭 8 桁 ÷ 2^32 < holdout なら検証用。

    乱数を使わないので、同じトレースは必ず同じ側に入る。
    """
    h = int(hashlib.sha256(trace_id.encode("utf-8")).hexdigest()[:8], 16)
    return h / 2**32 < holdout


@dataclass(frozen=True)
class FitResult:
    calibration: Calibration
    train_traces: int
    validation_traces: int
    at_bound: tuple[str, ...]
    before: dict[str, object]  # 検証用・校正なし
    after: dict[str, object]  # 検証用・校正あり

    def summary(self) -> dict[str, object]:
        return {
            "model": self.calibration.model,
            "temperatures": dict(self.calibration.temperatures),
            "trainTraces": self.train_traces,
            "validationTraces": self.validation_traces,
            "atUpperBound": list(self.at_bound),
            "validation": {"before": self.before, "after": self.after},
        }


def _model_of(samples: Sequence[Sample]) -> str:
    models = {s.answer.model for s in samples}
    if len(models) != 1:
        msg = f"答えたモデルが混在している（{len(models)} 種類）"
        raise CalibrationRefused(msg)
    model = models.pop()
    if not model or model != model.strip():
        msg = "答えたモデル名が空か、前後に空白がある"
        raise CalibrationRefused(msg)
    if model in MODEL_ALIASES:
        msg = f"答えたモデル名が別名（{model}）。実体の名前の答えで学ぶ"
        raise CalibrationRefused(msg)
    return model


def _check_classes(samples: Sequence[Sample]) -> None:
    for q in NOUL_IDS:
        pos = sum(1 for s in samples if s.labels.noul(q))
        neg = len(samples) - pos
        if pos < MIN_CLASS or neg < MIN_CLASS:
            msg = f"{q}: 学習用の正 {pos}・負 {neg}（各 {MIN_CLASS} 件以上が要る）"
            raise CalibrationRefused(msg)
    counts = {k: sum(1 for s in samples if s.labels.alert_level == k) for k in ALERT_LEVELS}
    if sum(1 for v in counts.values() if v >= MIN_CLASS) < MIN_CHOICE_CLASSES:
        msg = f"alert_level: {MIN_CLASS} 件以上のクラスが 2 つ未満（{counts}）"
        raise CalibrationRefused(msg)


def calibrate(
    samples: Sequence[Sample],
    *,
    min_samples: int = DEFAULT_MIN_SAMPLES,
    holdout: float = DEFAULT_HOLDOUT,
    override_conf: float = L1Config().override_conf,
    allow_synthetic: bool = False,
) -> FitResult:
    """R7 の判定をすべて通ったときだけ Calibration を返す。通らなければ CalibrationRefused。"""
    model = _model_of(samples)
    if not allow_synthetic and any(s.source == SYNTHETIC for s in samples):
        msg = "合成のデータ（source=synthetic）を含む。実機に置く温度は実機の答えで学ぶ"
        raise CalibrationRefused(msg)
    train = [s for s in samples if not is_validation(s.trace_id, holdout)]
    valid = [s for s in samples if is_validation(s.trace_id, holdout)]
    n_train = len({s.trace_id for s in train})
    n_valid = len({s.trace_id for s in valid})
    if n_train < min_samples:
        msg = f"学習用の別々のトレースが {n_train}（{min_samples} 以上が要る）"
        raise CalibrationRefused(msg)
    if n_valid < MIN_VALIDATION:
        msg = f"検証用の別々のトレースが {n_valid}（{MIN_VALIDATION} 以上が要る）"
        raise CalibrationRefused(msg)
    _check_classes(train)
    temps = fit_temperatures(train)
    sharp = [q for q, t in temps.items() if t < MIN_SAFE_T]
    if sharp:
        msg = f"T が {MIN_SAFE_T} 未満（分離できるデータか、鋭くしすぎ）: {', '.join(sharp)}"
        raise CalibrationRefused(msg)
    at_bound = tuple(q for q, t in temps.items() if t >= MAX_T * (1.0 - BOUND_RTOL))
    if at_bound:
        logger.warning("l1.calibrate.bound", extra={"questions": list(at_bound), "t": MAX_T})
    calibration = Calibration(model=model, temperatures=temps)
    used = _applied(valid, calibration)
    gate = override_metrics([s.answer for s in used], used, override_conf)
    if gate.danger_downgraded:
        msg = (
            f"検証用で正解 danger を {gate.danger_downgraded} 件降格する"
            f"（{dict(sorted(gate.danger_by_pattern.items()))}）"
        )
        raise CalibrationRefused(msg)
    # 降格の誤り = 正解 danger の降格。上の判定は「検証用の降格の精度 1.0」と同じ（0.9 より厳しい）
    return FitResult(
        calibration=calibration,
        train_traces=n_train,
        validation_traces=n_valid,
        at_bound=at_bound,
        before=evaluate(valid, None, override_conf),
        after=evaluate(valid, calibration, override_conf),
    )


# ---- 書き出し（R8） ----


def write_calibration(path: Path, calibration: Calibration) -> None:
    """同じディレクトリの一時ファイル → load_calibration で読み戻して一致 → 置き換え。

    失敗したら一時ファイルを消し、前のファイルを残して CalibrationWriteError。
    """
    payload = {
        "version": VERSION,
        "model": calibration.model,
        "temperatures": {q: round(calibration.temperatures[q], DIGITS) for q in QUESTION_IDS},
    }
    tmp = path.with_name(f".{path.name}.tmp")
    try:
        text = json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
        tmp.write_text(text, encoding="utf-8")
        loaded = load_calibration(tmp)
        if loaded is None or loaded != Calibration(payload["model"], payload["temperatures"]):
            msg = "読み戻した校正が書いたものと違う（形・範囲・モデル名）"
            raise CalibrationWriteError(msg)
        tmp.replace(path)
    except (OSError, ValueError) as exc:
        msg = f"{path} に書けない（{type(exc).__name__}）"
        raise CalibrationWriteError(msg) from exc
    finally:
        tmp.unlink(missing_ok=True)


# ---- 実行の口（R10） ----


def _override_conf(text: str) -> float:
    try:
        v = float(text)
    except ValueError as exc:
        msg = "数ではない"
        raise argparse.ArgumentTypeError(msg) from exc
    lo, hi = OVERRIDE_CONF_RANGE
    if not (math.isfinite(v) and lo <= v <= hi):
        msg = f"{lo}〜{hi}（B2-5: 0.9 より下げられない）"
        raise argparse.ArgumentTypeError(msg)
    return v


def _holdout(text: str) -> float:
    try:
        v = float(text)
    except ValueError as exc:
        msg = "数ではない"
        raise argparse.ArgumentTypeError(msg) from exc
    lo, hi = HOLDOUT_RANGE
    if not (math.isfinite(v) and lo <= v <= hi):
        msg = f"{lo}〜{hi}"
        raise argparse.ArgumentTypeError(msg)
    return v


def _positive_int(text: str) -> int:
    try:
        v = int(text)
    except ValueError as exc:
        msg = "整数ではない"
        raise argparse.ArgumentTypeError(msg) from exc
    if v < DEFAULT_MIN_SAMPLES:
        msg = f"{DEFAULT_MIN_SAMPLES} 以上（目標の下限より下げない）"
        raise argparse.ArgumentTypeError(msg)
    return v


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m detector.l1.calibrate", description=__doc__)
    sub = p.add_subparsers(dest="command", required=True)
    default_conf = L1Config().override_conf
    fit = sub.add_parser("fit", help="質問ごとの温度を学び calibration.json を書く")
    fit.add_argument("answers", type=Path)
    fit.add_argument("--out", type=Path, required=True)
    fit.add_argument("--report", type=Path)
    fit.add_argument("--min-samples", type=_positive_int, default=DEFAULT_MIN_SAMPLES)
    fit.add_argument("--holdout", type=_holdout, default=DEFAULT_HOLDOUT)
    fit.add_argument("--override-conf", type=_override_conf, default=default_conf)
    fit.add_argument("--allow-synthetic", action="store_true", help="テスト用。実機に置かない")
    ev = sub.add_parser("evaluate", help="校正なし・校正ありの ECE・NLL・降格の指標")
    ev.add_argument("answers", type=Path)
    ev.add_argument("--calibration", type=Path, required=True)
    ev.add_argument("--override-conf", type=_override_conf, default=default_conf)
    return p


def _emit(data: dict[str, object]) -> None:
    sys.stdout.write(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n")


def _fail(reason: str, code: int) -> int:
    sys.stderr.write(f"calibrate: {reason}\n")
    return code


def _run_fit(args: argparse.Namespace) -> int:
    samples = load_samples(args.answers)
    result = calibrate(
        samples,
        min_samples=args.min_samples,
        holdout=args.holdout,
        override_conf=args.override_conf,
        allow_synthetic=args.allow_synthetic,
    )
    write_calibration(args.out, result.calibration)
    summary = {"written": str(args.out), **result.summary()}
    if args.report is not None:
        text = json.dumps(summary, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
        args.report.write_text(text, encoding="utf-8")
    _emit(summary)
    return EXIT_OK


def _run_evaluate(args: argparse.Namespace) -> int:
    samples = load_samples(args.answers)
    calibration = load_calibration(args.calibration)
    if calibration is None:
        return _fail(f"{args.calibration} を校正として読めない", EXIT_INPUT)
    _emit(
        {
            "calibration": str(args.calibration),
            "raw": evaluate(samples, None, args.override_conf),
            "calibrated": evaluate(samples, calibration, args.override_conf),
        }
    )
    return EXIT_OK


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command == "fit":
            return _run_fit(args)
        return _run_evaluate(args)
    except CalibrationRefused as exc:
        return _fail(f"書かない: {exc}", EXIT_REFUSED)
    except (CalibrationDataError, CalibrationWriteError) as exc:
        return _fail(str(exc), EXIT_INPUT)
    except OSError as exc:
        return _fail(f"入出力の失敗（{type(exc).__name__}）", EXIT_INPUT)


if __name__ == "__main__":
    raise SystemExit(main())
