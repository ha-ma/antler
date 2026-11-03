"""L1 の校正（B2-5 の前提、B2-7 のファイルの形）: 質問ごとの温度で確率を当て直す。

calibration.json = {"version": 1, "model": "<実体のモデル名>", "temperatures": {4 問: T}}。
無い・壊れている → None（校正なし。上書きしない）。学習（l1/calibrate.py）は Step 4。
"""

from __future__ import annotations

import json
import logging
import math
from dataclasses import dataclass
from typing import TYPE_CHECKING

from detector.l1.client import L1Answer
from detector.l1.questions import QUESTION_IDS

if TYPE_CHECKING:
    from pathlib import Path

__all__ = ["MODEL_ALIASES", "Calibration", "load_calibration"]

logger = logging.getLogger("detector.l1")

VERSION = 1
MIN_T, MAX_T = 0.05, 20.0
EPS = 1e-6
# local-jev が既定のモデルに割り当てる別名。実体が分からないので校正の相手にしない
MODEL_ALIASES = frozenset({"jev-latest", "jev-preview", "local-jev-latest"})


def _clip(p: float) -> float:
    return min(1.0 - EPS, max(EPS, p))


def _sigmoid(x: float) -> float:
    if x >= 0:
        return 1.0 / (1.0 + math.exp(-x))
    e = math.exp(x)
    return e / (1.0 + e)


@dataclass(frozen=True)
class Calibration:
    model: str
    temperatures: dict[str, float]

    def matches(self, model: str) -> bool:
        return bool(model) and model not in MODEL_ALIASES and model == self.model

    def noul(self, qid: str, p: float) -> float:
        """sigmoid(logit(p) / T)。"""
        q = _clip(p)
        return _sigmoid(math.log(q / (1.0 - q)) / self.temperatures[qid])

    def choice(self, qid: str, probs: dict[str, float]) -> dict[str, float]:
        """softmax(log(p_i) / T)。"""
        t = self.temperatures[qid]
        logits = {k: math.log(_clip(v)) / t for k, v in probs.items()}
        top = max(logits.values())
        exps = {k: math.exp(v - top) for k, v in logits.items()}
        total = sum(exps.values())
        return {k: v / total for k, v in exps.items()}

    def apply(self, answer: L1Answer) -> L1Answer:
        return L1Answer(
            model=answer.model,
            alert_level=self.choice("alert_level", answer.alert_level),
            on_roadway=self.noul("on_roadway", answer.on_roadway),
            static_shoulder=self.noul("static_shoulder", answer.static_shoulder),
            false_positive=self.noul("false_positive", answer.false_positive),
        )


class _Invalid(Exception):
    pass


def _parse(raw: object) -> Calibration:
    if not isinstance(raw, dict) or raw.get("version") != VERSION:
        raise _Invalid
    model = raw.get("model")
    if not isinstance(model, str) or not model.strip() or model in MODEL_ALIASES:
        raise _Invalid
    temps = raw.get("temperatures")
    if not isinstance(temps, dict) or set(temps) != set(QUESTION_IDS):
        raise _Invalid
    out = {}
    for qid, t in temps.items():
        if isinstance(t, bool) or not isinstance(t, int | float):
            raise _Invalid
        if not (math.isfinite(t) and MIN_T <= t <= MAX_T):
            raise _Invalid
        out[qid] = float(t)
    return Calibration(model=model, temperatures=out)


def load_calibration(path: Path) -> Calibration | None:
    """読めなければ None（校正なし）。理由を 1 回ログに残す。中身はログに出さない。"""
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        logger.warning("l1.calibration_unavailable", extra={"reason": "missing"})
        return None
    except (OSError, UnicodeDecodeError) as exc:
        logger.warning(
            "l1.calibration_unavailable",
            extra={"reason": "unreadable", "error_type": type(exc).__name__},
        )
        return None
    try:
        calibration = _parse(json.loads(text, parse_constant=_reject_constant))
    except (ValueError, _Invalid):
        logger.warning("l1.calibration_unavailable", extra={"reason": "invalid"})
        return None
    logger.info("l1.calibration_loaded", extra={"model": calibration.model})
    return calibration


def _reject_constant(name: str) -> float:
    msg = f"JSON に {name} は書けない"
    raise ValueError(msg)
