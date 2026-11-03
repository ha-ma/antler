"""L0 のトラッカーと指標（B2-2・B2-6）: IoU で結び、距離・横方向速度・TTC を決定的なコードで出す。

数値の判断はモデルにさせない。乱数を使わず、同じ入力列で同じ ID・同じ値になる。
時刻はフレームの撮影時刻 t_frame だけを使う。赤の判定（Judge）には影響しない。
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from datetime import timedelta
from typing import TYPE_CHECKING

from detector.judge import interpolate_distance_m, is_blind, side_of

if TYPE_CHECKING:
    from datetime import datetime

    from detector.config import TrackerConfig
    from detector.pipeline import FrameResult
    from detector.ports import Detection

logger = logging.getLogger("detector.l0")

__all__ = [
    "MAX_DETECTIONS",
    "MAX_POINTS",
    "MIN_CLOSING_MPS",
    "MIN_SPAN_S",
    "RESET_BACK_S",
    "Observation",
    "Track",
    "TrackMetrics",
    "Tracker",
    "iou",
    "track_distance_m",
]

MIN_SPAN_S = 0.2  # 速度を出す最短の時間差（5 fps の 1 間隔）。これ未満は「測れない」
MIN_CLOSING_MPS = 0.5  # これ以下の接近は「近づいていない」→ TTC は None
MAX_POINTS = 64  # JudgeRequest の track の上限
RESET_BACK_S = 1.0  # t_frame がこれより大きく戻ったら作り直す
MAX_DETECTIONS = 16  # 1 フレームでトラッカーに入れる検出の上限（計算量を抑える）

Box = tuple[float, float, float, float]
Table = tuple[tuple[float, float], ...]


def iou(a: Box, b: Box) -> float:
    """中心 xywh（正規化）の 2 つのボックスの IoU。"""
    ax0, ay0, ax1, ay1 = a[0] - a[2] / 2, a[1] - a[3] / 2, a[0] + a[2] / 2, a[1] + a[3] / 2
    bx0, by0, bx1, by1 = b[0] - b[2] / 2, b[1] - b[3] / 2, b[0] + b[2] / 2, b[1] + b[3] / 2
    w = min(ax1, bx1) - max(ax0, bx0)
    h = min(ay1, by1) - max(ay0, by0)
    if w <= 0.0 or h <= 0.0:
        return 0.0
    inter = w * h
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union > 0.0 else 0.0


def track_distance_m(height: float, table: Table) -> float:
    """距離 m（小数）。表より近い側は端から反比例で外挿し、4 m より近くても距離が縮む。"""
    near_h, near_m = table[-1]
    if height > near_h:
        return near_m * near_h / height
    return interpolate_distance_m(height, table)


@dataclass(frozen=True)
class Observation:
    t: datetime
    conf: float
    xywh: Box
    distance_m: float
    offset_m: float  # 横位置。右が正（画面中央からの m）


@dataclass
class Track:
    id: int
    points: list[Observation] = field(default_factory=list)

    @property
    def last(self) -> Observation:
        return self.points[-1]


@dataclass(frozen=True)
class TrackMetrics:
    track_id: int
    distance_m: float
    lateral_mps: float
    ttc_s: float | None
    side: str
    pos: str


def _seconds(a: datetime, b: datetime) -> float:
    return (a - b).total_seconds()


def _usable(d: Detection, min_conf: float) -> bool:
    height = d.xywh[3]
    return d.label == "deer" and d.conf >= min_conf and math.isfinite(height) and height > 0.0


class Tracker:
    """イベントループの上で、判定の後に 1 フレームずつ update する。"""

    def __init__(self, config: TrackerConfig, table: Table, first_id: int = 1) -> None:
        self._cfg = config
        self._table = table
        self._tan = math.tan(math.radians(config.hfov_deg) / 2.0)
        self._tracks: list[Track] = []
        self._latest: datetime | None = None
        self.next_id = first_id

    @property
    def tracks(self) -> tuple[Track, ...]:
        return tuple(self._tracks)

    def update(self, result: FrameResult) -> None:
        if is_blind(result):
            return  # 見えていないフレームでは時刻も進めない
        t = result.t_frame
        if self._latest is not None and t <= self._latest:
            if _seconds(self._latest, t) <= RESET_BACK_S:
                return  # 同時刻・少しの戻り: 結び付けも追加もしない
            back_s = round(_seconds(self._latest, t), 3)
            logger.warning("l0.tracker_reset", extra={"back_s": back_s})
            self._tracks = []
        self._latest = t
        max_age = timedelta(seconds=self._cfg.max_age_s)
        self._tracks = [tr for tr in self._tracks if t - tr.last.t <= max_age]
        dets = [d for d in result.detections if _usable(d, self._cfg.min_conf)]
        if len(dets) > MAX_DETECTIONS:
            # 送信の前に走るので件数に上限を置く。確信度の高いものを残し、検出の順は保つ
            keep = sorted(range(len(dets)), key=lambda i: -dets[i].conf)[:MAX_DETECTIONS]
            dets = [dets[i] for i in sorted(keep)]
        pairs = sorted(
            (
                (iou(tr.last.xywh, d.xywh), tr.id, j)
                for tr in self._tracks
                for j, d in enumerate(dets)
            ),
            key=lambda p: (-p[0], p[1], p[2]),
        )
        by_id = {tr.id: tr for tr in self._tracks}
        used_tracks: set[int] = set()
        used_dets: set[int] = set()
        for score, track_id, j in pairs:
            if score < self._cfg.iou_threshold:
                break
            if track_id in used_tracks or j in used_dets:
                continue
            used_tracks.add(track_id)
            used_dets.add(j)
            self._append(by_id[track_id], dets[j], t)
        for j, d in enumerate(dets):
            if j not in used_dets:
                track = Track(self.next_id)
                self.next_id += 1
                self._tracks.append(track)
                self._append(track, d, t)

    def _append(self, track: Track, d: Detection, t: datetime) -> None:
        distance = track_distance_m(d.xywh[3], self._table)
        offset = (d.xywh[0] - 0.5) * 2.0 * self._tan * distance
        track.points.append(Observation(t, d.conf, d.xywh, distance, offset))
        window = timedelta(seconds=self._cfg.window_s)
        track.points = [p for p in track.points if t - p.t <= window][-MAX_POINTS:]

    def primary(self) -> Track | None:
        """主トラック: 最新の時刻に見えた中でいちばん高いボックス。

        最新の時刻に見えたトラックが無ければ、最後に見た時刻がいちばん新しいもの。
        """
        if not self._tracks:
            return None
        now = [tr for tr in self._tracks if tr.last.t == self._latest]
        if now:
            return max(now, key=lambda tr: (tr.last.xywh[3], tr.last.conf, -tr.id))
        return max(self._tracks, key=lambda tr: (tr.last.t, -tr.id))

    def _lateral_mps(self, track: Track, point: Observation) -> float:
        first = track.points[0]
        span = _seconds(point.t, first.t)
        if span < MIN_SPAN_S:
            return 0.0
        rightward = (point.offset_m - first.offset_m) / span
        return rightward if side_of(point.xywh[0]) == "L" else -rightward  # 正 = 進路へ近づく

    def metrics(self, track: Track) -> TrackMetrics:
        first, last = track.points[0], track.last
        span = _seconds(last.t, first.t)
        ttc = None
        if span >= MIN_SPAN_S:
            closing = (first.distance_m - last.distance_m) / span
            if closing > MIN_CLOSING_MPS:
                ttc = last.distance_m / closing
        return TrackMetrics(
            track.id,
            last.distance_m,
            self._lateral_mps(track, last),
            ttc,
            side_of(last.xywh[0]),
            self._pos(last),
        )

    def _pos(self, point: Observation) -> str:
        return "lane" if abs(point.offset_m) <= self._cfg.lane_half_width_m else "shoulder"

    def track_points(self, track: Track) -> list[dict[str, object]]:
        """JudgeRequest の track（TrackPoint の形）。t は最新を 0 とした 0 以下の秒、昇順。"""
        last = track.last
        return [
            {
                "t": round(min(0.0, _seconds(p.t, last.t)), 3),
                "conf": float(p.conf),
                "distanceM": round(p.distance_m, 3),
                "lateralMps": round(self._lateral_mps(track, p), 3),
                "side": side_of(p.xywh[0]),
                "pos": self._pos(p),
            }
            for p in track.points
        ]
