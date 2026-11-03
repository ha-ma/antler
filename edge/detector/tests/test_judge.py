"""UC-1・UC-2: 判定と距離・方向。"""

import math

import pytest

from detector.config import DEFAULT_DISTANCE_TABLE, JudgeConfig
from detector.judge import Judge, estimate_distance_m, side_of

from .conftest import deer, result


def feed(judge: Judge, steps: list[tuple[float, list]], mono0: float = 0.0) -> list[bool]:
    out = []
    for ms, dets in steps:
        out.append(judge.update(result(ms, *dets), mono0 + ms / 1000))
    return out


def j(**kw) -> Judge:
    return Judge(JudgeConfig(**kw))


# UC-1a
def test_uc1a_2フレーム連続でON_1フレームではならない():
    judge = j()
    feed(judge, [(0, [])])
    assert judge.update(result(100, deer()), 0.1) is False
    assert not judge.state.deer
    assert judge.update(result(200, deer()), 0.2) is True
    assert judge.state.deer and judge.state.conf == 0.9


# UC-1b
def test_uc1b_間に鹿なしが挟まると数え直す_閾値ちょうどは鹿あり():
    judge = j()
    feed(judge, [(0, [deer()]), (100, []), (200, [deer()])])
    assert not judge.state.deer
    feed(judge, [(300, [deer(conf=0.4)])])
    assert judge.state.deer
    j2 = j()
    feed(j2, [(0, [deer(conf=0.39)]), (100, [deer(conf=0.39)])])
    assert not j2.state.deer


# UC-1c
def test_uc1c_間隔が1秒超なら連続と数えない():
    judge = j()
    feed(judge, [(0, [deer()]), (1100, [deer()])])
    assert not judge.state.deer
    feed(judge, [(1200, [deer()])])
    assert judge.state.deer


# UC-1d・S-3
def test_uc1d_1_5秒ちょうどでOFF_1_499秒はON():
    judge = j()
    feed(judge, [(0, [deer()]), (100, [deer()])])
    assert judge.update(result(1599), 1.6) is False and judge.state.deer
    assert judge.update(result(1600), 1.7) is True and not judge.state.deer


# UC-1e
def test_uc1e_見るたびに更新され_1枚欠けてもON():
    judge = j()
    feed(judge, [(0, [deer()]), (100, [deer()]), (200, []), (1000, [deer()]), (1100, [])])
    assert judge.state.deer
    assert judge.update(result(2500), 2.5) is True  # 最後に見た 1000 から 1.5 秒


# UC-1f
def test_uc1f_failedは連続を切らず数えない_続けばOFF():
    judge = j()
    judge.update(result(0, deer()), 0.0)
    judge.update(result(100, failed=True), 0.1)
    assert judge.update(result(200, deer()), 0.2) is True and judge.state.deer
    judge.update(result(300, failed=True), 0.3)
    assert judge.state.deer
    assert judge.update(result(1800, failed=True), 1.8) is True and not judge.state.deer


# UC-1g
def test_uc1g_複数なら高さ最大の検出で決める():
    judge = j()
    near, far = deer(conf=0.5, x=0.8, h=0.3), deer(conf=0.95, x=0.1, h=0.05)
    feed(judge, [(0, [far, near]), (100, [far, near])])
    s = judge.state
    assert (s.conf, s.side) == (0.5, "R")
    assert s.distance_m == estimate_distance_m(0.3, DEFAULT_DISTANCE_TABLE)


# UC-1h
def test_uc1h_ONの間は距離が最新になる_OFFでは持たない():
    judge = j()
    feed(judge, [(0, [deer(h=0.05)]), (100, [deer(h=0.05)])])
    assert judge.state.distance_m == 33
    feed(judge, [(200, [deer(h=0.2)])])
    assert judge.state.distance_m == 8 and judge.state.t_frame == result(200).t_frame
    feed(judge, [(2000, [])])
    assert (judge.state.distance_m, judge.state.side, judge.state.conf) == (None, None, None)


# UC-1i
def test_uc1i_方向は2フレーム続いたときだけ変わる():
    judge = j()
    feed(judge, [(0, [deer(x=0.3)]), (100, [deer(x=0.3)])])
    assert judge.state.side == "L"
    changes = feed(
        judge,
        [(200, [deer(x=0.7)]), (300, [deer(x=0.3)]), (400, [deer(x=0.7)]), (500, [deer(x=0.3)])],
    )
    assert judge.state.side == "L" and not any(changes)
    changes = feed(judge, [(600, [deer(x=0.7)]), (700, [deer(x=0.7)])])
    assert judge.state.side == "R" and changes == [False, True]


# UC-1j
def test_uc1j_高い確信度でも1フレームではONにならない():
    judge = j()
    judge.update(result(0, deer(conf=0.99)), 0.0)
    assert not judge.state.deer


# UC-1k・FAIL-5
def test_uc1k_t_frameが戻ってもONを解かない():
    judge = j()
    feed(judge, [(5000, [deer()]), (5100, [deer()])])
    assert judge.update(result(1000), 5.2) is False and judge.state.deer


def test_expire_は単調時計で判定する():
    judge = j()
    feed(judge, [(0, [deer()]), (100, [deer()])], mono0=10.0)
    assert judge.expire(11.4) is False
    assert judge.expire(11.6) is True and not judge.state.deer
    assert judge.expire(99.0) is False


# UC-2a
def test_uc2a_表の点と点の間():
    t = DEFAULT_DISTANCE_TABLE
    assert estimate_distance_m(0.05, t) == 33
    assert estimate_distance_m(0.075, t) == round((33 + 16) / 2)
    assert estimate_distance_m(0.15, t) == 12


# UC-2b
def test_uc2b_表の外は端の値():
    assert estimate_distance_m(0.01, DEFAULT_DISTANCE_TABLE) == 55
    assert estimate_distance_m(0.9, DEFAULT_DISTANCE_TABLE) == 4


# UC-2c
@pytest.mark.parametrize(("x", "side"), [(0.49, "L"), (0.5, "R"), (0.51, "R")])
def test_uc2c_中心xの左右(x, side):
    assert side_of(x) == side


# UC-2d
@pytest.mark.parametrize("h", [0.0, -0.1, math.nan])
def test_uc2d_高さが使えない検出は鹿として使わない(h):
    judge = j()
    feed(judge, [(0, [deer(h=h)]), (100, [deer(h=h)])])
    assert not judge.state.deer
