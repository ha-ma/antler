"""画像の縮小と JPEG 化の port（B3-3: 320 px。docs/specs/edge-capture E1）。

エンコーダは port（Protocol）にして、実体は OpenCV（`camera` extra）。Exif などを書かない。
OpenCV が無い環境では OpenCvJpegEncoder().encode が EncodeError を出す（検知は止まらない）。
"""

from __future__ import annotations

from typing import Protocol

import numpy as np

__all__ = ["EncodeError", "JpegEncoder", "OpenCvJpegEncoder", "shrink"]

MAX_WIDTH = 1280


class EncodeError(Exception):
    """JPEG にできない（エンコーダが無い・失敗）。"""


class JpegEncoder(Protocol):
    def encode(self, image: np.ndarray, quality: int) -> bytes: ...


def shrink(image: np.ndarray, width: int) -> np.ndarray:
    """最近傍で幅 width（高さは比を保つ）に縮める。元の配列とメモリを共有しないコピー。"""
    if not 1 <= width <= MAX_WIDTH:
        msg = f"幅は 1〜{MAX_WIDTH}: {width}"
        raise ValueError(msg)
    source_h, source_w = image.shape[:2]
    height = max(1, round(source_h * width / source_w))
    if source_w % width == 0 and source_h % height == 0:
        # 整数倍（640×480 → 320×240 など）は間引きの切り出しで済む（fancy index より速い）
        view = image[:: source_h // height, :: source_w // width]
        return np.array(view, copy=True, order="C")
    rows = np.arange(height) * source_h // height
    cols = np.arange(width) * source_w // width
    return np.ascontiguousarray(image[rows[:, None], cols[None, :]])


class OpenCvJpegEncoder:
    def encode(self, image: np.ndarray, quality: int) -> bytes:
        try:
            import cv2  # 任意の依存（camera extra）。無くても検知は動く
        except ImportError as exc:
            msg = "opencv が無い"
            raise EncodeError(msg) from exc
        try:
            ok, buffer = cv2.imencode(".jpg", image, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
        except cv2.error as exc:
            msg = "imencode が失敗"
            raise EncodeError(msg) from exc
        if not ok:
            msg = "imencode が False"
            raise EncodeError(msg)
        return bytes(buffer.tobytes())
