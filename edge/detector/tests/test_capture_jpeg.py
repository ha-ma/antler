"""capture.jpeg（docs/specs/edge-capture E1・REC-1f）: 縮小とエンコーダの port。"""

from __future__ import annotations

import numpy as np
import pytest

from detector.capture.jpeg import EncodeError, OpenCvJpegEncoder, shrink


def _image(width: int = 640, height: int = 480) -> np.ndarray:
    rows = np.arange(height, dtype=np.uint16)[:, None]
    cols = np.arange(width, dtype=np.uint16)[None, :]
    image = np.zeros((height, width, 3), dtype=np.uint8)
    image[..., 0] = (rows % 256).astype(np.uint8)
    image[..., 1] = (cols % 256).astype(np.uint8)
    image[..., 2] = ((rows + cols) % 256).astype(np.uint8)
    return image


def test_REC_1f_縮小は幅を指定し高さは比を保つ() -> None:
    small = shrink(_image(), 320)
    assert small.shape == (240, 320, 3)
    assert small.dtype == np.uint8
    assert shrink(_image(), 160).shape == (120, 160, 3)
    assert shrink(_image(), 640).shape == (480, 640, 3)


def test_REC_1f_縮小は元の画像のコピーで元を書き換えても変わらない() -> None:
    source = _image()
    small = shrink(source, 320)
    before = small.copy()
    source[:] = 0
    assert np.array_equal(small, before)
    assert not np.shares_memory(small, source)


def test_REC_1f_縮小は最近傍で決定的() -> None:
    source = _image()
    assert np.array_equal(shrink(source, 320), source[::2, ::2])


def test_REC_1f_幅が元より大きい_0以下は拒否() -> None:
    with pytest.raises(ValueError, match="幅"):
        shrink(_image(), 0)
    with pytest.raises(ValueError, match="幅"):
        shrink(_image(), 1281)


def test_REC_1f_OpenCVのエンコーダはJFIFだけのJPEGを返す() -> None:
    pytest.importorskip("cv2")
    data = OpenCvJpegEncoder().encode(shrink(_image(), 320), 80)
    assert data[:3] == b"\xff\xd8\xff"
    assert data[-2:] == b"\xff\xd9"
    # APP0（JFIF）以外のメタデータ（Exif・XMP などの APPn、コメント）を持たない
    markers = _markers(data)
    assert 0xE0 in markers
    assert not [m for m in markers if 0xE1 <= m <= 0xEF or m == 0xFE]
    assert len(data) < 40_000


def test_FAIL_1_エンコードに失敗したらEncodeError() -> None:
    pytest.importorskip("cv2")
    with pytest.raises(EncodeError):
        OpenCvJpegEncoder().encode(np.zeros((0, 0, 3), dtype=np.uint8), 80)


def _markers(data: bytes) -> list[int]:
    out: list[int] = []
    i = 2
    while i + 4 <= len(data):
        if data[i] != 0xFF:
            break
        marker = data[i + 1]
        out.append(marker)
        if marker == 0xDA:  # SOS: ここから先は画像本体
            break
        length = int.from_bytes(data[i + 2 : i + 4], "big")
        i += 2 + length
    return out
