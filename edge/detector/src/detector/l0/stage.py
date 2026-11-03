"""L0 の即時ルール（B2-3）: 赤を鳴らす唯一の層。判定を先に決め、続けてトラッカーを更新する。

赤の経路は同期のまま（L1・L2 を await しない）。トラッカーが壊れても判定は止めない。
イベントループの上だけで触る（Judge と同じ）。
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Protocol

from detector.config import TrackerConfig
from detector.judge import Judge
from detector.l0.tracker import Tracker

if TYPE_CHECKING:
    from collections.abc import Callable

    from detector.config import JudgeConfig
    from detector.judge import JudgeState
    from detector.l0.tracker import Track, TrackMetrics
    from detector.pipeline import FrameResult

logger = logging.getLogger("detector.l0")

FAIL_LOG_INTERVAL_S = 1.0


class TrackerLike(Protocol):
    next_id: int

    def update(self, result: FrameResult) -> None: ...
    def primary(self) -> Track | None: ...
    def metrics(self, track: Track) -> TrackMetrics: ...


class L0Stage:
    def __init__(
        self,
        judge: JudgeConfig,
        tracker: TrackerConfig | None = None,
        tracker_factory: Callable[[int], TrackerLike] | None = None,
    ) -> None:
        self.judge = Judge(judge)
        cfg = tracker or TrackerConfig()
        self._factory = tracker_factory or (
            lambda first_id: Tracker(cfg, judge.distance_table, first_id)
        )
        self.tracker: TrackerLike = self._factory(1)
        self._last_fail_log: float | None = None

    @property
    def state(self) -> JudgeState | None:
        return self.judge.state

    def update(self, result: FrameResult, now: float) -> bool:
        """判定（赤の ON/OFF）を先に決め、同じ呼び出しでトラッカーを進める。戻り値は判定のもの。"""
        changed = self.judge.update(result, now)
        try:
            self.tracker.update(result)
        except Exception as exc:  # noqa: BLE001  トラッカーの失敗で赤を止めない
            self._failed(exc, now)
        return changed

    def expire(self, now: float) -> bool:
        return self.judge.expire(now)

    def primary_metrics(self, now: float) -> TrackMetrics | None:
        """主トラックの指標（ログ用）。生きたトラックが無い・壊れたときは None。"""
        try:
            track = self.tracker.primary()
            return None if track is None else self.tracker.metrics(track)
        except Exception as exc:  # noqa: BLE001  ログのための計算で送信を止めない
            self._failed(exc, now)
            return None

    def _failed(self, exc: Exception, now: float) -> None:
        if self._last_fail_log is None or now - self._last_fail_log >= FAIL_LOG_INTERVAL_S:
            self._last_fail_log = now
            logger.warning("l0.tracker_failed", extra={"error_type": type(exc).__name__})
        self.tracker = self._factory(self.tracker.next_id)  # ID は続きから（再利用しない）
