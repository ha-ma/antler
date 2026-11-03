"""HUB-1・LOG-1: 配信（edge-l1 R5・R6・R9）。降格で再送し、AlertFlag.l1 を付ける。赤は待たない。"""

import json

from detector.config import JudgeConfig, L1Config
from detector.frame import format_t_frame
from detector.fusion import HOLD_MAX_S, L1Verdict
from detector.hub import AlertHub

from .conftest import Clock, deer, named, result
from .test_runner import VALIDATOR


def make_hub(clock=None, **l1):
    sent = []
    clock = clock or Clock()
    hub = AlertHub(JudgeConfig(), clock=clock, l1=L1Config(**l1))
    hub.sender = lambda t: sent.append(json.loads(t)) or 1
    return hub, sent, clock


def red(hub, clock, ms0=0.0, x=0.4):
    for i in range(2):
        clock.advance(0.1)
        hub.on_result(result(ms0 + 100 * i, deer(0.9, x=x)))


def verdict(hub, clock, **kw) -> L1Verdict:
    target, _ = hub.l1_target()
    base = {
        "episode": hub.fusion.episode,
        "track_id": target.track_id,
        "started": clock(),
        "latency_ms": 42.25,
        "model": "llm-qwen2.5-1.5b",
        "calibrated": True,
        "alert_level": "zone",
        "conf": 0.95,
        "conf_raw": 0.95,
        "reason": "false_positive",
    }
    base.update(kw)
    return L1Verdict(**base)


# HUB-1a・HUB-1d
def test_hub1a_降格でdeer_falseとl1_overrodeが再送されJSON_Schemaに通る(logbuf):
    hub, sent, clock = make_hub()
    red(hub, clock)
    assert sent[-1]["deer"] is True and "l1" not in sent[-1]  # 赤は答えを待たずに出た
    hub.on_l1(verdict(hub, clock))
    flag = sent[-1]
    assert flag["deer"] is False
    assert flag["l1"] == {"alert_level": "zone", "conf": 0.95, "overrode": True, "latencyMs": 42.2}
    assert "conf" not in flag and "distanceM" not in flag
    assert VALIDATOR.is_valid(flag)
    log = named(logbuf, "flag.sent")[-1]
    assert log["reason"] == "l1" and log["l1"]["overrode"] is True
    result_log = named(logbuf, "l1.result")[-1]
    assert result_log["route"] == "override" and result_log["overrode"] is True


# HUB-1b
def test_hub1b_出力が変わらない答えでは再送せず次のハートビートにl1が付く():
    hub, sent, clock = make_hub()
    red(hub, clock)
    n = len(sent)
    hub.on_l1(verdict(hub, clock, alert_level="danger", conf=0.97, reason=None))
    assert len(sent) == n
    clock.advance(1.0)
    hub.tick()
    beat = sent[-1]
    assert beat["deer"] is True
    assert beat["l1"] == {
        "alert_level": "danger",
        "conf": 0.97,
        "overrode": False,
        "latencyMs": 42.2,
    }
    assert VALIDATOR.is_valid(beat)


# HUB-1c
def test_hub1c_降格中のハートビートとsnapshotもdeer_falseとl1を運ぶ():
    hub, sent, clock = make_hub()
    red(hub, clock)
    hub.on_l1(verdict(hub, clock))
    clock.advance(1.0)
    hub.on_result(result(300, deer(0.9, x=0.4)))  # 鹿は見え続けている（L0 は赤のまま）
    hub.tick()
    assert sent[-1]["deer"] is False and sent[-1]["l1"]["overrode"] is True
    snap = json.loads(hub.snapshot())
    assert snap["deer"] is False and snap["l1"]["overrode"] is True


# HUB-1e
def test_hub1e_l1を渡さないハブは従来どおり():
    sent = []
    hub = AlertHub(JudgeConfig(), clock=Clock())
    hub.sender = lambda t: sent.append(json.loads(t)) or 1
    assert hub.fusion is None and hub.l1_target() is None
    hub.on_l1(None)  # 何もしない
    hub.on_l1_failed()
    red(hub, Clock())
    assert sent[-1]["deer"] is True and "l1" not in sent[-1]
    disabled = AlertHub(JudgeConfig(), l1=L1Config(enabled=False))
    assert disabled.fusion is None


# HUB-1f
def test_hub1f_保留の設定でL1が健全なら150msまで赤を待ち答えで決める():
    hub, sent, clock = make_hub(wait_for_l1_before_red=True)
    hub.l1_healthy = True
    red(hub, clock)
    assert sent[-1]["deer"] is False and hub.l1_wake.is_set()  # 保留中
    hub.on_l1(verdict(hub, clock))  # 降格の答え
    assert sent[-1]["deer"] is False
    clock.advance(HOLD_MAX_S + 0.01)
    hub.tick()
    assert all(not f["deer"] for f in sent)  # 赤は一度も鳴らない（この設定の性質）


def test_hub1f_保留の期限が来たらtickが赤を送る():
    hub, sent, clock = make_hub(wait_for_l1_before_red=True)
    hub.l1_healthy = True
    red(hub, clock)
    assert sent[-1]["deer"] is False
    clock.advance(HOLD_MAX_S)
    hub.tick()
    assert sent[-1]["deer"] is True


def test_hub1f_L1が失敗中なら保留しない_保留中の失敗で即赤():
    hub, sent, clock = make_hub(wait_for_l1_before_red=True)
    hub.l1_healthy = False
    red(hub, clock)
    assert sent[-1]["deer"] is True
    hub2, sent2, clock2 = make_hub(wait_for_l1_before_red=True)
    hub2.l1_healthy = True
    red(hub2, clock2)
    assert sent2[-1]["deer"] is False
    hub2.on_l1_failed()
    assert sent2[-1]["deer"] is True


# HUB-1g
def test_hub1g_NaNをJSONに書かず赤は止めない(logbuf):
    hub, _, clock = make_hub()
    raw = []
    hub.sender = lambda t: raw.append(t) or 1
    clock.advance(0.1)
    hub.on_result(result(0, deer(float("nan"))))  # 壊れた conf（不正として捨てられる）
    red(hub, clock, ms0=100)
    assert all("NaN" not in t for t in raw)
    assert raw[-1] and json.loads(raw[-1])["deer"] is True
    broken = {"deer": True, "conf": float("nan"), "distanceM": float("inf"), "l1": {"conf": 1.0}}
    text = AlertHub.dumps_finite(broken)
    assert "NaN" not in text and "Infinity" not in text
    assert json.loads(text) == {"deer": True, "conf": 0.0, "distanceM": 0.0}  # deer は届く
    assert named(logbuf, "flag.non_finite")


class BrokenFusion:
    episode = 1

    def __getattr__(self, name):
        def boom(*args, **kw):
            raise RuntimeError("boom")

        return boom


# HUB-1j: [ADDED review] fusion が壊れても赤は L0 のまま出る
def test_hub1j_fusionが例外を出しても赤は送られる(logbuf):
    hub, sent, clock = make_hub()
    hub.fusion = BrokenFusion()
    red(hub, clock)
    assert sent[-1]["deer"] is True and "l1" not in sent[-1]
    clock.advance(1.0)
    hub.tick()
    assert sent[-1]["deer"] is True
    assert json.loads(hub.snapshot())["deer"] is True
    assert named(logbuf, "fusion.failed")


# HUB-1h
def test_hub1h_入力が止まっているあいだの答えでは何も送らない():
    hub, sent, clock = make_hub()
    red(hub, clock)
    v = verdict(hub, clock)
    clock.advance(1.0)  # 1.5 秒より前（L0 は赤のまま）だが、stall_after_s を超えるよう進める
    hub._last_ok = clock() - 3.5
    n = len(sent)
    hub.on_l1(v)
    assert len(sent) == n


# HUB-1i
def test_hub1i_降格から赤に戻すフラグは今のL0の値でackの基準はそのフレーム(logbuf):
    hub, sent, clock = make_hub()
    red(hub, clock)
    hub.on_l1(verdict(hub, clock))
    clock.advance(0.1)
    hub.on_result(result(200, deer(0.93, x=0.4, h=0.2)))
    hub.on_l1_failed()
    back = sent[-1]
    assert back["deer"] is True and back["conf"] == 0.93 and back["distanceM"] == 8
    assert back["t_frame"] == format_t_frame(result(200).t_frame)
    hub.on_client_message(json.dumps({"type": "ack", "t_shown": "2027-02-15T07:31:08.400+00:00"}))
    ack = named(logbuf, "ack")[-1]
    assert ack["t_frame"] == back["t_frame"] and ack["since_frame_ms"] == 200.0


# LOG-1a（hub 側）
def test_log1a_flag_sentとl1_resultに状態や質問文を出さない(logbuf):
    hub, _, clock = make_hub()
    red(hub, clock)
    hub.on_l1(verdict(hub, clock))
    text = logbuf.getvalue()
    for word in ('track"', "lateralMps", "distanceM", "The detection", "questions"):
        assert word not in text
