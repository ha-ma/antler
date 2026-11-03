"""判定（B2-4）: 2 フレーム連続で ON、1.5 秒検知なしで OFF。距離はボックス高さ、方向は中心の左右。

イベントループの上だけで触る（スレッドから呼ばない）。時刻は 2 種類を分けて持つ:
フレームの撮影時刻 t_frame（連続・解除の判定。戻っても ON を早く解かない）と、
単調時計 now（入力が止まったときの expire。壁時計の跳びに影響されない）。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from itertools import pairwise
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from detector.config import JudgeConfig
    from detector.pipeline import FrameResult
    from detector.ports import Detection

CONSECUTIVE_FRAMES = 2
MAX_STREAK_GAP = timedelta(seconds=1.0)


@dataclass(frozen=True)
class JudgeState:
    deer: bool
    t_frame: datetime
    conf: float | None = None
    distance_m: int | None = None
    side: str | None = None


def estimate_distance_m(height: float, table: tuple[tuple[float, float], ...]) -> int:
    """ボックス高さ → 距離 m。表を線形補間し、表の外は端の値で止める。"""
    if height <= table[0][0]:
        return round(table[0][1])
    if height >= table[-1][0]:
        return round(table[-1][1])
    for (h0, m0), (h1, m1) in pairwise(table):
        if h0 <= height <= h1:
            return round(m0 + (m1 - m0) * (height - h0) / (h1 - h0))
    return round(table[-1][1])  # 到達しない


def side_of(center_x: float) -> str:
    return "L" if center_x < 0.5 else "R"


def _usable(d: Detection, threshold: float) -> bool:
    height = d.xywh[3]
    return d.conf >= threshold and math.isfinite(height) and height > 0.0


class Judge:
    def __init__(self, config: JudgeConfig) -> None:
        self._cfg = config
        self._off_after = timedelta(seconds=config.off_after_s)
        self.state: JudgeState | None = None
        self._streak = 0
        self._last_hit_t: datetime | None = None
        self._last_hit_mono = 0.0
        self._pending_side: str | None = None
        self._pending_count = 0

    def update(self, result: FrameResult, now: float) -> bool:
        """1 フレーム分の結果を取り込む。ON/OFF の切り替えと方向の変化で True。"""
        t = result.t_frame
        if result.failed:
            return self._maybe_off(t)
        hits = [d for d in result.detections if _usable(d, self._cfg.threshold)]
        if not hits:
            self._streak = 0
            self._pending_side = None
            changed = self._maybe_off(t)
            if self.state is None:
                self.state = JudgeState(False, t)
                return True
            if not self.state.deer:
                self.state = JudgeState(False, t)
            return changed
        best = max(hits, key=lambda d: d.xywh[3])
        gap_ok = self._last_hit_t is None or t - self._last_hit_t <= MAX_STREAK_GAP
        self._streak = self._streak + 1 if self._streak and gap_ok else 1
        self._last_hit_t = t if self._last_hit_t is None else max(self._last_hit_t, t)
        self._last_hit_mono = now
        distance = estimate_distance_m(best.xywh[3], self._cfg.distance_table)
        side = side_of(best.xywh[0])
        was_on = self.state is not None and self.state.deer
        if not was_on:
            if self._streak < CONSECUTIVE_FRAMES:
                if self.state is None:
                    self.state = JudgeState(False, t)
                    return True
                self.state = JudgeState(False, t)
                return False
            self._pending_side = None
            self.state = JudgeState(True, t, best.conf, distance, side)
            return True
        assert self.state is not None  # noqa: S101
        new_side, changed = self.state.side, False
        if side == self.state.side:
            self._pending_side, self._pending_count = None, 0
        else:
            self._pending_count = self._pending_count + 1 if self._pending_side == side else 1
            self._pending_side = side
            if self._pending_count >= CONSECUTIVE_FRAMES:
                new_side, changed = side, True
                self._pending_side, self._pending_count = None, 0
        self.state = JudgeState(True, self._last_hit_t, best.conf, distance, new_side)
        return changed

    def expire(self, now: float) -> bool:
        """入力が止まっても、最後に鹿を見てから off_after 秒で OFF にする（単調時計）。"""
        if self.state is None or not self.state.deer:
            return False
        if now - self._last_hit_mono >= self._cfg.off_after_s:
            self.state = JudgeState(False, self.state.t_frame)
            self._streak = 0
            return True
        return False

    def _maybe_off(self, t: datetime) -> bool:
        if self.state is None or not self.state.deer or self._last_hit_t is None:
            return False
        if t - self._last_hit_t >= self._off_after:  # 戻り（負の経過）は 0 として扱われる
            self.state = JudgeState(False, t)
            self._streak = 0
            return True
        return False
