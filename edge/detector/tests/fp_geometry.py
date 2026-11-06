"""合成の鹿の枠（l0-fp-filter の FPA・FPF-1c）。ピンホールのカメラで、地面に立つ鹿を枠にする。

カメラは水平（地平線が画面の中央）、高さ 1.2 m、水平画角 70°（config の暫定値）。
画面の縦横比は 16:9（カメラの 1280×720 を 640×480 に引き伸ばす。縦の画角が狭く、枠は高くなる）と
4:3 の 2 通り。画面の外に出た部分は切り詰める（画面の端で一部だけ写る鹿）。
"""

from __future__ import annotations

import math

from detector.ports import Detection

HFOV_DEG = 70.0
CAMERA_HEIGHT_M = 1.2
ASPECTS = {"16:9": 9 / 16, "4:3": 3 / 4}


def deer_box(
    distance_m: float,
    lateral_m: float,
    length_m: float = 1.7,
    height_m: float = 1.6,
    aspect: str = "16:9",
) -> tuple[float, float, float, float] | None:
    """距離・横位置（左が負）の鹿の正規化 xywh。画面に写らなければ None。"""
    tan_h = math.tan(math.radians(HFOV_DEG / 2))
    tan_v = tan_h * ASPECTS[aspect]
    half_w = 2 * distance_m * tan_h  # その距離で画面の横に写る幅（m）
    half_h = 2 * distance_m * tan_v
    cx = 0.5 + lateral_m / half_w
    w = length_m / half_w
    feet = 0.5 + CAMERA_HEIGHT_M / half_h
    top = feet - height_m / half_h
    x1, x2 = max(0.0, cx - w / 2), min(1.0, cx + w / 2)
    y1, y2 = max(0.0, top), min(1.0, feet)
    if x2 <= x1 or y2 <= y1:
        return None
    return ((x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1)


def deer(xywh: tuple[float, float, float, float], conf: float = 0.9) -> Detection:
    return Detection("deer", conf, xywh)


def approach(
    start_m: float = 40.0,
    end_m: float = 1.2,
    kmh: float = 60.0,
    fps: float = 10.0,
) -> list[float]:
    """一定の速さで近づく鹿の、フレームごとの距離（最後は end_m ちょうど）。"""
    step = kmh / 3.6 / fps
    count = int((start_m - end_m) / step) + 1
    out = [start_m - step * i for i in range(count)]
    if out[-1] > end_m:
        out.append(end_m)
    return out
