"""L0 の誤検出の後処理（docs/specs/l0-fp-filter）。

トラッカーと即時ルールの手前で鹿の枠を除く・弱める。

- 規則 a: 画面の大部分を覆う枠（面積・幅と高さの割合が大きすぎる）を除く。既定値は、本物の鹿なら
  カメラから 2 m より近い枠だけに当たる（水平画角 70° の暫定値での見積もり）
- 規則 b: 車載カメラの取り付けで決まる「無視する領域」に 8 割以上入る枠の確信度を下げる
  （0 なら除く）
- 続き: 直前 3 秒にそのまま通した枠と IoU 0.3 以上で重なる枠は、規則 a・b に当たっても通す
  （遠くから近づいた鹿・止まった車の前にいる鹿・群れの手前の鹿の赤を落とさない）

画像を見ない算術だけ。推論のスレッドだけが呼ぶ（状態は直前 3 秒の枠だけ）。
例外は DeerDetector が受けて、除かない側に倒す。
"""

from __future__ import annotations

import logging
from collections import deque
from dataclasses import replace
from time import monotonic
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Callable

    from detector.config import L0FilterConfig
    from detector.ports import Detection

logger = logging.getLogger("detector.l0")

Box = tuple[float, float, float, float]

# 境界ちょうど（0.7 ちょうど・8 割ちょうど）を浮動小数の誤差で取りこぼさない
EPS = 1e-9
# 「続き」とみなす直前の時間。YOLO が至近の鹿を 1 秒あまり見失ってから見つけ直しても除かない
# （赤の解除 1.5 秒より長く。edge-latency-reviewer W2）。単調時計で測る（実走では t_frame と揃う。
# 動画を実時間より速く流すと、フレームの数では長めの窓になる＝除かない側）
CONTINUITY_S = 3.0
CONTINUITY_IOU = 0.3  # 「続き」とみなす重なり（トラッカーの iou_threshold の既定と同じ）
SEEDS_PER_FRAME = 8  # 1 フレームで「続き」の元に覚える枠（確信度の高い順）
CHECKS_PER_FRAME = 16  # 1 フレームで「続き」を調べる大きい枠（確信度の高い順。計算量を抑える）
SEED_FRAMES = 30  # 覚えるフレームの上限（10 fps で 3 秒。呼ばれ方が速くても計算量を抑える）


def _in_any(xywh: Box, regions: tuple[Box, ...], need: float) -> bool:
    """枠の面積のうち、どれか 1 つの領域の中にある割合が need 以上か（割合は領域ごと。足さない）。

    面積 0 の枠はどの領域にも入らない（0 で割らない）。枠の端は 1 回だけ計算する。
    """
    cx, cy, w, h = xywh
    need_area = need * w * h
    if need_area <= 0.0:
        return False
    bx1, bx2, by1, by2 = cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2
    for x1, y1, x2, y2 in regions:
        ix = (bx2 if bx2 < x2 else x2) - (bx1 if bx1 > x1 else x1)
        if ix <= 0.0:
            continue
        iy = (by2 if by2 < y2 else y2) - (by1 if by1 > y1 else y1)
        if iy > 0.0 and ix * iy >= need_area:
            return True
    return False


def _continues(xywh: Box, previous: list[tuple[float, float, float, float, float]]) -> bool:
    """直前の枠（x1, y1, x2, y2, 面積）のどれかと IoU が CONTINUITY_IOU 以上か。

    IoU ≤ 小さい面積 ÷ 大きい面積 なので、面積が 0.3 倍より違う枠は計算せずに飛ばす。
    """
    cx, cy, w, h = xywh
    area = w * h  # 面積 0 なら lo = hi = 0 で、面積が正の元はどれも飛ばされる
    need = CONTINUITY_IOU - EPS
    lo, hi = area * need, area / need
    ax1, ay1, ax2, ay2 = cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2
    for bx1, by1, bx2, by2, b_area in previous:
        if b_area < lo or b_area > hi:
            continue
        ix = (ax2 if ax2 < bx2 else bx2) - (ax1 if ax1 > bx1 else bx1)
        iy = (ay2 if ay2 < by2 else by2) - (ay1 if ay1 > by1 else by1)
        if ix <= 0.0 or iy <= 0.0:
            continue
        inter = ix * iy
        if inter >= need * (area + b_area - inter):
            return True
    return False


def _corners(xywh: Box) -> tuple[float, float, float, float, float]:
    cx, cy, w, h = xywh
    return (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, w * h)


class BoxFilter:
    """鹿の検出の列を受け、除いた・弱めた後の列を返す（並びは確信度の高い順）。"""

    def __init__(self, cfg: L0FilterConfig, clock: Callable[[], float] = monotonic) -> None:
        self._cfg = cfg
        self._clock = clock
        self._regions = cfg.ignore_regions
        self._need = cfg.region_min_inside - EPS
        # （時刻, そのフレームでそのまま通した枠の角と面積）。直前 CONTINUITY_S 秒だけ
        self._seeds: deque[tuple[float, list[tuple[float, float, float, float, float]]]] = deque(
            maxlen=SEED_FRAMES
        )

    def _reason(self, xywh: Box) -> str | None:
        cfg = self._cfg
        w, h = xywh[2], xywh[3]
        if w * h >= cfg.max_area - EPS:
            return "area"
        if w >= cfg.max_width - EPS and h >= cfg.min_height_at_max_width - EPS:
            return "width"
        if self._regions and _in_any(xywh, self._regions, self._need):
            return "region_drop" if cfg.region_conf_scale <= 0.0 else "region_scaled"
        return None

    def _previous(self, now: float) -> list[tuple[float, float, float, float, float]]:
        while self._seeds and now - self._seeds[0][0] > CONTINUITY_S:
            self._seeds.popleft()
        return [b for _, boxes in self._seeds for b in boxes]

    @property
    def remembered(self) -> int:
        """「続き」の元として覚えている枠の数（古いものは次の呼び出しで捨てる）。"""
        return sum(len(boxes) for _, boxes in self._seeds)

    def __call__(self, detections: list[Detection]) -> list[Detection]:
        now = self._clock()
        previous = self._previous(now)
        counts = {"area": 0, "width": 0, "region_drop": 0, "region_scaled": 0, "continued": 0}
        removed: list[float] = []
        kept: list[Detection] = []
        passed: list[Detection] = []  # そのまま通した枠（確信度の順。次のフレームの「続き」の元）
        checks = 0
        for d in sorted(detections, key=lambda d: d.conf, reverse=True):
            reason = self._reason(d.xywh)
            if reason is not None and previous and checks < CHECKS_PER_FRAME:
                checks += 1
                if _continues(d.xywh, previous):
                    counts["continued"] += 1
                    reason = None
            if reason is None:
                kept.append(d)
                passed.append(d)
                continue
            counts[reason] += 1
            removed.append(d.conf)
            if reason == "region_scaled":
                kept.append(replace(d, conf=d.conf * self._cfg.region_conf_scale))  # 座標はそのまま
        if passed:  # 枠の無いフレームは元を押し出さない
            self._seeds.append((now, [_corners(d.xywh) for d in passed[:SEEDS_PER_FRAME]]))
        if removed or counts["continued"]:
            _log(counts, removed, len(kept))
        return sorted(kept, key=lambda d: d.conf, reverse=True)


def _log(counts: dict[str, int], removed: list[float], kept: int) -> None:
    logger.info(
        "l0.filtered",
        extra={**counts, "max_conf_removed": max(removed) if removed else None, "kept": kept},
    )


def build_box_filter(
    cfg: L0FilterConfig, clock: Callable[[], float] = monotonic
) -> BoxFilter | None:
    """設定から後処理を作る。切ってあれば None（DeerDetector は従来どおり）。"""
    return BoxFilter(cfg, clock) if cfg.enabled else None
