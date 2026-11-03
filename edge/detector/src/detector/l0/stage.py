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

    @property
    def tracks(self) -> tuple[Track, ...]: ...
    def update(self, result: FrameResult) -> None: ...
    def primary(self) -> Track | None: ...
    def metrics(self, track: Track) -> TrackMetrics: ...
    def track_points(self, track: Track) -> list[dict[str, object]]: ...


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

    def red_tracks(self, threshold: float) -> list[Track]:
        """赤の候補: 生きているトラックのうち、最後の点の確信度が閾値以上のもの（edge-l1）。"""
        try:
            return [tr for tr in self.tracker.tracks if tr.last.conf >= threshold]
        except Exception:  # noqa: BLE001  分からなければ候補なし（降格しない側）
            return []

    def _failed(self, exc: Exception, now: float) -> None:
        """失敗を 1 秒に 1 回まで残し、トラッカーを作り直す。例外を外へ出さない（赤を止めない）。"""
        if self._last_fail_log is None or now - self._last_fail_log >= FAIL_LOG_INTERVAL_S:
            self._last_fail_log = now
            logger.warning("l0.tracker_failed", extra={"error_type": type(exc).__name__})
        next_id = getattr(self.tracker, "next_id", 1)
        try:
            self.tracker = self._factory(next_id)  # ID は続きから（再利用しない）
        except Exception:  # noqa: BLE001  作り直しの失敗でも判定は続ける。次のフレームで再挑戦
            self.tracker = _NullTracker(next_id)


class _NullTracker:
    """作り直しに失敗したあいだの代わり。何も追わない（トラッカーの値は null になる）。"""

    def __init__(self, next_id: int) -> None:
        self.next_id = next_id

    @property
    def tracks(self) -> tuple[Track, ...]:
        return ()

    def track_points(self, track: Track) -> list[dict[str, object]]:
        return []

    def update(self, result: FrameResult) -> None:
        msg = "トラッカーを作り直せていない"
        raise RuntimeError(msg)

    def primary(self) -> Track | None:
        return None

    def metrics(self, track: Track) -> TrackMetrics:
        msg = "トラッカーを作り直せていない"
        raise RuntimeError(msg)
