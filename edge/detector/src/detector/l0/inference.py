"""L0 の一次推論（B2-2）。deer の選別とテスト用のフェイク。実モデルの読み込みは l0/coreml.py。

edge-l0 で detector/inference.py から移した。ログの名前（detector.inference）は変えない。
"""

from __future__ import annotations

import logging
import math
from time import monotonic
from typing import TYPE_CHECKING

from detector.ports import Detection, Detector

if TYPE_CHECKING:
    from collections.abc import Callable

    import numpy as np

logger = logging.getLogger("detector.inference")

FAIL_LOG_INTERVAL_S = 1.0

__all__ = ["DeerDetector", "Detection", "Detector", "ScriptedDetector"]


def _valid(d: Detection) -> bool:
    return (
        not math.isnan(d.conf)
        and 0.0 <= d.conf <= 1.0
        and len(d.xywh) == 4
        and all(not math.isnan(v) and 0.0 <= v <= 1.0 for v in d.xywh)
    )


class DeerDetector:
    """下の Detector を包み、deer だけを確信度の高い順に返す。不正な検出は捨てて警告する。

    box_filter（l0-fp-filter の後処理）を渡すと、選別の後に当てる。後処理が例外を出したら
    元の検出をそのまま返す（除かない側。赤を落とさない）。`l0.fp_filter_failed` は 1 秒に 1 回まで。
    """

    def __init__(
        self,
        inner: Detector,
        box_filter: Callable[[list[Detection]], list[Detection]] | None = None,
        clock: Callable[[], float] = monotonic,
    ) -> None:
        self._inner = inner
        self._filter = box_filter
        self._clock = clock
        self._last_fail_log: float | None = None
        self.last_invalid = 0  # 直近の detect で捨てた不正な検出の数（後処理で除いた枠は数えない）

    def detect(self, image: np.ndarray) -> list[Detection]:
        kept = []
        self.last_invalid = 0
        for d in self._inner.detect(image):
            if d.label != "deer":
                continue
            if not _valid(d):
                self.last_invalid += 1
                logger.warning("detection.invalid", extra={"conf": str(d.conf)})
                continue
            kept.append(d)
        if self._filter is not None and kept:
            try:
                return sorted(self._filter(kept), key=lambda d: d.conf, reverse=True)
            except Exception as exc:  # noqa: BLE001  後処理の失敗で赤を落とさない
                self._filter_failed(exc)
        return sorted(kept, key=lambda d: d.conf, reverse=True)

    def _filter_failed(self, exc: Exception) -> None:
        now = self._clock()
        if self._last_fail_log is None or now - self._last_fail_log >= FAIL_LOG_INTERVAL_S:
            self._last_fail_log = now
            logging.getLogger("detector.l0").warning(
                "l0.fp_filter_failed", extra={"error_type": type(exc).__name__}
            )


class ScriptedDetector:
    """テスト用のフェイク。与えた列を順に返し、尽きたら空。呼ばれた画像の形を覚える。"""

    def __init__(self, script: list[list[Detection]]) -> None:
        self._script = list(script)
        self.seen_shapes: list[tuple[int, ...]] = []

    def detect(self, image: np.ndarray) -> list[Detection]:
        self.seen_shapes.append(tuple(image.shape))
        return self._script.pop(0) if self._script else []
