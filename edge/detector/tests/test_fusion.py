"""FU-1: fusion（edge-l1 R5）。L0 の赤に、L1 の答えで降格だけを重ねる。"""

from dataclasses import replace

import pytest

from detector.config import JudgeConfig, L1Config, TrackerConfig
from detector.fusion import FLIP_GUARD_S, Fusion, L1Verdict, conclude
from detector.l0.stage import L0Stage

from .conftest import deer, result

LANE_X = 0.45  # 16 m 先で中央から 1.1 m（lane）
SHOULDER_X = 0.4  # 16 m 先で中央から 2.2 m（shoulder）


class Rig:
    def __init__(self, cfg: L1Config | None = None) -> None:
        self.l0 = L0Stage(JudgeConfig(), TrackerConfig())
        self.fu = Fusion(cfg or L1Config(), self.l0, 0.8)
        self.ms = 0.0
        self.now = 100.0

    def frame(self, *dets, dt: float = 0.1) -> None:
        self.ms += dt * 1000.0
        self.now += dt
        self.l0.update(result(self.ms, *dets), self.now)
        self.fu.after_l0(self.now)

    def red(self, x: float = SHOULDER_X, conf: float = 0.9) -> None:
        self.frame(deer(conf, x=x))
        self.frame(deer(conf, x=x))
        assert self.l0.state.deer

    def verdict(self, **kw) -> L1Verdict:
        target = self.fu.target()
        base = {
            "episode": self.fu.episode,
            "track_id": target.track_id if target else 1,
            "started": self.now,
            "latency_ms": 50.0,
            "model": "llm-qwen2.5-1.5b",
            "calibrated": True,
            "alert_level": "zone",
            "conf": 0.95,
            "conf_raw": 0.95,
            "reason": "false_positive",
        }
        base.update(kw)
        return L1Verdict(**base)


def test_conclude_結論と理由():
    levels = {"none": 0.02, "zone": 0.03, "danger": 0.95}
    assert conclude(levels, 0.91, 0.9) == ("zone", 0.91, "false_positive")
    assert conclude({"none": 0.0, "zone": 0.93, "danger": 0.07}, 0.1, 0.9) == (
        "zone",
        0.93,
        "alert_level",
    )
    assert conclude({"none": 0.95, "zone": 0.0, "danger": 0.05}, 0.1, 0.9)[2] == "alert_level"
    assert conclude(levels, 0.1, 0.9) == ("danger", 0.95, None)
    assert conclude({"none": 0.4, "zone": 0.4, "danger": 0.2}, 0.1, 0.9) == ("zone", 0.4, None)
    assert (
        conclude({"none": 0.4, "zone": 0.2, "danger": 0.4}, 0.1, 0.9)[0] == "danger"
    )  # 同点は危ない側


# FU-1a
def test_fu1a_false_positive校正後0_9以上で今のエピソード同じトラックなら降格():
    r = Rig()
    r.red()
    assert r.fu.apply(r.verdict()) == "override"
    assert r.fu.refresh(r.now) is True
    assert r.fu.l1_field() == {
        "alert_level": "zone",
        "conf": 0.95,
        "overrode": True,
        "latencyMs": 50.0,
    }


# FU-1b
@pytest.mark.parametrize("level", ["zone", "none"])
def test_fu1b_alert_levelのzoneかnoneが0_9以上で降格(level):
    r = Rig()
    r.red()
    v = r.verdict(alert_level=level, conf=0.92, reason="alert_level")
    assert r.fu.apply(v) == "override"
    assert r.fu.refresh(r.now)
    assert r.fu.l1_field()["alert_level"] == level


# FU-1c
@pytest.mark.parametrize(
    ("conf", "level", "route"),
    [(0.89, "zone", "l2_candidate"), (0.5, "danger", "l2_candidate"), (0.49, "zone", "log")],
)
def test_fu1c_0_9未満やdangerは降格しない(conf, level, route):
    r = Rig()
    r.red()
    assert r.fu.apply(r.verdict(alert_level=level, conf=conf, reason=None)) == route
    assert r.fu.refresh(r.now) is False
    assert r.fu.l1_field()["overrode"] is False


# FU-1d
def test_fu1d_校正なしは降格せずl1を付けない():
    r = Rig()
    r.red()
    assert r.fu.apply(r.verdict(calibrated=False, reason=None)) == "uncalibrated"
    assert r.fu.refresh(r.now) is False
    assert r.fu.l1_field() is None


# FU-1e
def test_fu1e_エピソードより前や前のエピソードの答えでは降格しない():
    r = Rig()
    r.frame(deer(0.9))  # まだ赤でない（1 フレーム）
    early = r.verdict()  # episode None で作った問い合わせ
    r.frame(deer(0.9))
    assert r.fu.apply(early) == "no_episode"
    assert not r.fu.refresh(r.now)
    old = r.verdict()
    r.now += 2.0
    r.ms += 2000.0
    r.frame()  # 鹿が消えて解除
    r.red()
    assert r.fu.apply(old) == "no_episode"
    assert not r.fu.refresh(r.now)


# FU-1f
def test_fu1f_赤の候補でないトラックや2頭では降格しない():
    r = Rig()
    r.red()
    v = r.verdict(track_id=999)
    r.fu.apply(v)
    assert not r.fu.refresh(r.now)
    r2 = Rig()
    two = (deer(0.9, x=0.2), deer(0.9, x=0.8))
    r2.frame(*two)
    r2.frame(*two)
    r2.fu.apply(r2.verdict())
    assert not r2.fu.refresh(r2.now)


def test_fu1f_降格中に2頭目が閾値を超えると赤に戻る():
    r = Rig()
    r.red()
    r.fu.apply(r.verdict())
    assert r.fu.refresh(r.now)
    r.frame(deer(0.9, x=SHOULDER_X), deer(0.85, x=0.8))
    assert r.fu.refresh(r.now) is False


def test_fu1f_赤のあいだは主トラックでなく赤の候補について聞く():
    r = Rig()
    sign = deer(0.45, x=0.7, h=0.3)  # 高く写る 0.45 の看板
    real = deer(0.85, x=SHOULDER_X, h=0.1)
    r.frame(sign, real)
    r.frame(sign, real)
    assert r.l0.state.deer
    primary = r.l0.tracker.primary()
    target = r.fu.target()
    assert target.track_id != primary.id
    assert [t.id for t in r.l0.red_tracks(0.8)] == [target.track_id]


# FU-1g
def test_fu1g_L0が赤でないときのdangerは何もしない():
    r = Rig()
    r.frame(deer(0.5))
    v = r.verdict(episode=None, alert_level="danger", conf=0.99, reason=None)
    assert r.fu.apply(v) == "no_episode"
    assert r.fu.refresh(r.now) is False
    assert r.fu.l1_field() is None


# FU-1h
def test_fu1h_降格中に条件を満たさない答えや失敗で赤に戻る():
    r = Rig()
    r.red()
    r.fu.apply(r.verdict())
    assert r.fu.refresh(r.now)
    r.fu.apply(r.verdict(alert_level="danger", conf=0.95, reason=None))
    assert r.fu.refresh(r.now) is False
    r2 = Rig()
    r2.red()
    r2.fu.apply(r2.verdict())
    assert r2.fu.refresh(r2.now)
    r2.fu.failed()
    assert r2.fu.refresh(r2.now) is False


# FU-1i
def test_fu1i_赤が解けるとエピソードが閉じl1が付かない():
    r = Rig()
    r.red()
    r.fu.apply(r.verdict())
    assert r.fu.l1_field() is not None
    r.frame(dt=1.6)  # 鹿なしのフレームで 1.5 秒を超える
    assert not r.l0.state.deer
    assert r.fu.episode is None and r.fu.l1_field() is None


# FU-1j
def test_fu1j_recentAlerts30sは直近30秒の赤の回数():
    r = Rig()
    for _ in range(3):
        r.red()
        r.frame(dt=1.6)
    assert r.fu.recent_alerts(r.now) == 3
    assert r.fu.recent_alerts(r.now + 31.0) == 0


# FU-1k
def test_fu1k_alert_levelが理由でlaneにいれば降格しない_false_positiveはする():
    r = Rig()
    r.red(x=LANE_X)
    r.fu.apply(r.verdict(reason="alert_level", alert_level="zone"))
    assert r.fu.refresh(r.now) is False
    r.fu.apply(r.verdict(reason="false_positive"))
    assert r.fu.refresh(r.now) is True


def test_fu1k_降格中にlaneへ入ると赤に戻る():
    r = Rig()
    r.red(x=SHOULDER_X)
    r.fu.apply(r.verdict(reason="alert_level", alert_level="zone"))
    assert r.fu.refresh(r.now)
    r.frame(deer(0.9, x=0.42))
    r.frame(deer(0.9, x=LANE_X))
    assert r.fu.refresh(r.now) is False


# FU-1l
def test_fu1l_答えが古くなると赤に戻る():
    r = Rig(L1Config(rate_hz=2.5, timeout_ms=800))
    r.red()
    r.fu.apply(r.verdict())
    assert r.fu.ttl_s == pytest.approx(2.0)
    assert r.fu.refresh(r.now + 2.0) is True
    assert r.fu.refresh(r.now + 2.01) is False


# FU-1m
def test_fu1m_赤に戻して1秒は再び降格しない():
    r = Rig()
    r.red()
    r.fu.apply(r.verdict())
    assert r.fu.refresh(r.now)
    r.fu.failed()
    assert not r.fu.refresh(r.now)  # 解除（赤へ）
    r.fu.apply(r.verdict())
    assert r.fu.refresh(r.now + FLIP_GUARD_S - 0.01) is False
    r.fu.apply(replace(r.verdict(), started=r.now + FLIP_GUARD_S))
    assert r.fu.refresh(r.now + FLIP_GUARD_S) is True


def test_l1_fieldは範囲に収める():
    r = Rig()
    r.red()
    r.fu.apply(r.verdict(conf=float("nan"), latency_ms=-3.0))
    field = r.fu.l1_field()
    assert field["conf"] == 0.0 and field["latencyMs"] == 0.0
