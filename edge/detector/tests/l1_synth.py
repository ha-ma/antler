"""edge-l1-calibration のテストの部品: 合成の L1 の答え（numpy の default_rng だけ。シード付き）。

- overconfident: 真の確率の logit を k 倍した「過信した」生の確率（k > 1 は過信、k < 1 は過小）。
  noul は sigmoid(k z)、choice は softmax(k Z)（= q^k の正規化）なので、T = k で真の確率に戻る
- scenario: 鹿でない物・路肩で静止した鹿・危険な鹿の 3 種類で、4 問の正解がそろった答え。
  生の確率は正解の側に寄せた潜在の値＋切り詰めた雑音を k 倍する（ときどき外す）
"""

from __future__ import annotations

import numpy as np

from detector.l1.calibrate import Labels, Sample
from detector.l1.client import L1Answer

from .l1_fakes import MODEL

LEVELS = ("none", "zone", "danger")
NOUL = ("on_roadway", "static_shoulder", "false_positive")


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-x))


def _softmax(x: np.ndarray) -> np.ndarray:
    e = np.exp(x - x.max())
    return e / e.sum()


def _sample(i, answer, labels, source, pattern, prefix) -> Sample:
    return Sample(
        id=f"{prefix}-{i}",
        answer=answer,
        labels=labels,
        trace_id=f"{prefix}-trace-{i}",
        source=source,
        pattern=pattern,
    )


def overconfident(
    n: int, k: float, seed: int, model: str = MODEL, source: str = "synthetic"
) -> list[Sample]:
    rng = np.random.default_rng(seed)
    out = []
    for i in range(n):
        z = rng.normal(0.0, 1.5, size=3)
        y = rng.random(3) < _sigmoid(z)
        raw = _sigmoid(k * z)
        zc = rng.normal(0.0, 1.2, size=3)
        label = LEVELS[int(rng.choice(3, p=_softmax(zc)))]
        rawc = _softmax(k * zc)
        answer = L1Answer(
            model=model,
            alert_level={lv: float(rawc[j]) for j, lv in enumerate(LEVELS)},
            **{q: float(raw[j]) for j, q in enumerate(NOUL)},
        )
        labels = Labels(label, **{q: bool(y[j]) for j, q in enumerate(NOUL)})
        out.append(_sample(i, answer, labels, source, None, f"oc{seed}"))
    return out


KINDS = {
    # kind: (labels, pattern)
    "decoy": (Labels("zone", on_roadway=False, static_shoulder=False, false_positive=True), "sign"),
    "static": (
        Labels("zone", on_roadway=False, static_shoulder=True, false_positive=False),
        "roadside",
    ),
    "danger": (
        Labels("danger", on_roadway=True, static_shoulder=False, false_positive=False),
        "crossing",
    ),
}


def scenario(
    n: int,
    seed: int,
    k: float = 2.0,
    noise: float = 0.8,
    model: str = MODEL,
    source: str = "synthetic",
    wrong_on_danger: float = 0.0,
) -> list[Sample]:
    """wrong_on_danger: 危険な鹿のうちこの割合に false_positive 0.999 を返す（間違う L1）。"""
    rng = np.random.default_rng(seed)
    kinds = rng.choice(["decoy", "static", "danger"], size=n, p=[0.3, 0.35, 0.35])
    out = []
    for i, kind in enumerate(kinds):
        labels, pattern = KINDS[str(kind)]

        def jitter(size=None):
            return np.clip(rng.normal(0.0, noise, size=size), -2 * noise, 2 * noise)

        noul = {}
        for q in NOUL:
            s = (1.2 if labels.noul(q) else -1.2) + float(jitter())
            if kind == "danger" and q == "false_positive":
                s = min(s, -0.8)  # 危険な鹿には「鹿でない」と強くは言わない L1
            noul[q] = float(_sigmoid(np.array(k * s)))
        logits = np.array([-1.5, 0.0, 0.0])
        logits[LEVELS.index(labels.alert_level)] = 1.2
        logits = logits + jitter(3)
        if kind == "danger":
            logits[:2] = np.minimum(logits[:2], logits[2] - 0.8)
        rawc = _softmax(k * logits)
        if kind == "danger" and rng.random() < wrong_on_danger:
            noul["false_positive"] = 0.999
        answer = L1Answer(
            model=model,
            alert_level={lv: float(rawc[j]) for j, lv in enumerate(LEVELS)},
            **noul,
        )
        out.append(_sample(i, answer, labels, source, pattern, f"sc{seed}"))
    return out
