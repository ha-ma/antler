"""UC-1b・UC-1c・UC-2: Frame の検証とリサイズ。"""

from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from detector.frame import Frame, format_t_frame, resize_frame

from .conftest import T0, frame_at, image


# UC-1b
def test_uc1b_不正な画像はValueError():
    with pytest.raises(ValueError, match="image"):
        Frame(np.zeros((48, 64), dtype=np.uint8), T0, 0)
    with pytest.raises(ValueError, match="image"):
        Frame(np.zeros((48, 64, 3), dtype=np.float32), T0, 0)
    with pytest.raises(ValueError, match="image"):
        Frame(np.zeros((48, 64, 4), dtype=np.uint8), T0, 0)


# UC-1c
def test_uc1c_naiveなt_frameは拒否しZもJSTに正規化する():
    with pytest.raises(ValueError, match="t_frame"):
        Frame(image(), datetime(2027, 2, 15, 16, 31, 8), 0)
    z = Frame(image(), T0, 0)
    jst = Frame(image(), T0.astimezone(timezone(timedelta(hours=9))), 1)
    assert z.t_frame == jst.t_frame
    assert format_t_frame(z.t_frame) == "2027-02-15T16:31:08.000+09:00"


# UC-2a
def test_uc2a_1080pから640x480へ_元は変えない():
    src = Frame(image(1920, 1080, value=7), T0, 5)
    out = resize_frame(src)
    assert out.image.shape == (480, 640, 3)
    assert (out.t_frame, out.seq) == (src.t_frame, 5)
    assert src.image.shape == (1080, 1920, 3)
    assert (out.image == 7).all()


# UC-2b
def test_uc2b_640x480は同じ中身_縦長は引き伸ばす():
    same = resize_frame(frame_at(0, width=640, height=480, value=9))
    assert same.image.shape == (480, 640, 3) and (same.image == 9).all()
    assert resize_frame(frame_at(0, width=480, height=640)).image.shape == (480, 640, 3)


# UC-2c
def test_uc2c_1x1は通り_幅0は拒否():
    assert resize_frame(frame_at(0, width=1, height=1, value=3)).image.shape == (480, 640, 3)
    with pytest.raises(ValueError, match="image"):
        Frame(np.zeros((10, 0, 3), dtype=np.uint8), T0, 0)
