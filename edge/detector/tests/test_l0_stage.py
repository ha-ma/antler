"""RULE-1・S-2: L0 の即時ルール（赤は L0 だけ・同期）とトラッカーの並走。"""

import inspect
import json

from detector.config import JudgeConfig, TrackerConfig
from detector.hub import AlertHub
from detector.l0.stage import L0Stage

from .conftest import Clock, deer, named, result


class Boom:
    """毎回壊れるトラッカー。"""

    def __init__(self, first_id: int = 1) -> None:
        self.next_id = first_id

    def update(self, result):
        raise RuntimeError("boom")

    def primary(self):
        raise RuntimeError("boom")

    def metrics(self, track):
        raise RuntimeError("boom")


def make_hub(clock=None, **kw):
    sent = []
    hub = AlertHub(JudgeConfig(), clock=clock or Clock(), **kw)
    hub.sender = lambda t: sent.append(json.loads(t)) or 1
    return hub, sent


def scenario():
    return [result(0)] + [result(100 * i, deer(h=0.1 + 0.02 * i)) for i in range(1, 7)]


def drive(hub, clock, results):
    for r in results:
        clock.advance(0.1)
        hub.on_result(r)
    clock.advance(2.0)
    hub.tick()


# RULE-1a
def test_rule1a_2フレーム目のon_resultの中で同期にONが送られる():
    clock = Clock()
    hub, sent = make_hub(clock)
    assert not inspect.iscoroutinefunction(hub.on_result)
    assert not inspect.iscoroutinefunction(L0Stage.update)
    hub.on_result(result(0, deer()))
    assert [f["deer"] for f in sent] == [False]
    hub.on_result(result(100, deer()))
    assert sent[-1]["deer"] is True  # 戻った時点で送り終わっている


# RULE-1b
def test_rule1b_トラッカーの有無で判定と送ったフラグの列が変わらない():
    def flags(**kw):
        clock = Clock()
        hub, sent = make_hub(clock, **kw)
        hub._wall = lambda: result(0).t_frame  # t_sent を固定して比べる
        drive(hub, clock, scenario())
        return sent

    with_tracker = flags()
    no_tracker = flags(l0=L0Stage(JudgeConfig(), tracker_factory=lambda i: Boom(i)))
    assert with_tracker == no_tracker
    assert [f["deer"] for f in with_tracker] == [False, True, False]


# RULE-1c・S-2
def test_rule1c_トラッカーが壊れてもONとOFFが送られる(logbuf):
    clock = Clock()
    l0 = L0Stage(JudgeConfig(), tracker_factory=lambda i: Boom(i))
    hub, sent = make_hub(clock, l0=l0)
    drive(hub, clock, scenario())
    assert [f["deer"] for f in sent] == [False, True, False]
    failed = named(logbuf, "l0.tracker_failed")
    assert failed and failed[0]["error_type"] == "RuntimeError"
    on = [e for e in named(logbuf, "flag.sent") if e["deer"]]
    assert on[0]["track_id"] is None  # 壊れたトラッカーの値は null


# RULE-1d
def test_rule1d_deer_trueのflag_sentにトラッカーの値_falseには付かない(logbuf):
    clock = Clock()
    hub, _ = make_hub(clock)
    drive(hub, clock, scenario())
    hub.on_result(result(5000, deer()))
    hub.on_result(result(5100, deer()))
    clock.advance(1.0)
    hub.tick()  # ハートビート
    hub._last_ok = clock()
    snap = hub.snapshot()
    assert snap is not None
    sent = named(logbuf, "flag.sent")
    on = [e for e in sent if e["deer"]]
    off = [e for e in sent if not e["deer"]]
    assert {e["reason"] for e in on} == {"change", "heartbeat", "snapshot"}
    assert all({"track_id", "ttc_s", "lateral_mps"} <= e.keys() for e in on)
    assert all(not ({"track_id", "ttc_s", "lateral_mps"} & e.keys()) for e in off)
    assert on[0]["track_id"] == 1


# RULE-1e
def test_rule1e_閾値の既定は0_8_0_79は赤にせずトラッカーは追う():
    hub, sent = make_hub()
    hub.on_result(result(0, deer(conf=0.8)))
    hub.on_result(result(100, deer(conf=0.8)))
    assert sent[-1]["deer"] is True  # 0.8 ちょうどは鹿あり
    assert JudgeConfig().threshold == 0.8
    l0 = L0Stage(JudgeConfig(), TrackerConfig())
    l0.update(result(0, deer(conf=0.79)), 0.0)
    l0.update(result(100, deer(conf=0.79)), 0.1)
    assert l0.state is not None and l0.state.deer is False
    assert [t.id for t in l0.tracker.tracks] == [1]


# RULE-1f
def test_rule1f_ONのflag_sentにはONを決めたフレームまでの値が載る(logbuf):
    clock = Clock()
    hub, _ = make_hub(clock)
    for ms in (0, 100, 200):  # 3 枚目で ON（1 枚目は閾値未満）
        clock.advance(0.1)
        hub.on_result(result(ms, deer(conf=0.3 if ms == 0 else 0.9, h=0.1 + ms / 1000)))
    on = next(e for e in named(logbuf, "flag.sent") if e["deer"])
    # 0.1 秒（2 点）では速度を出さないので 0.0、トラック ID は ON を決めたフレームのもの
    assert on["track_id"] == 1 and on["lateral_mps"] == 0.0 and on["ttc_s"] is None
    clock.advance(0.1)
    hub.on_result(result(300, deer(h=0.4)))
    clock.advance(1.0)
    hub.tick()
    beat = [e for e in named(logbuf, "flag.sent") if e["reason"] == "heartbeat"][-1]
    assert beat["ttc_s"] is not None and beat["ttc_s"] > 0


# RULE-1g
def test_rule1g_隠れてトラックが消えたらハートビートの3つはnull(logbuf):
    clock = Clock()
    hub, sent = make_hub(clock, tracker=TrackerConfig(max_age_s=0.5))
    hub.on_result(result(0, deer()))
    hub.on_result(result(100, deer()))
    clock.advance(0.1)
    hub.on_result(result(800))  # 鹿が隠れた。判定は 1.5 秒まで ON、トラックは 0.5 秒で消える
    clock.advance(1.0)
    hub.tick()
    assert sent[-1]["deer"] is True
    beat = named(logbuf, "flag.sent")[-1]
    assert beat["reason"] == "heartbeat"
    assert (beat["track_id"], beat["ttc_s"], beat["lateral_mps"]) == (None, None, None)


# RULE-1i
def test_rule1i_作り直しも失敗しても赤は送られ_次のフレームで作り直す(logbuf):
    calls = []

    def factory(first_id):
        calls.append(first_id)
        if len(calls) == 1:
            return Boom(first_id)
        if len(calls) == 2:
            raise OSError("作り直せない")
        return Boom(first_id)

    clock = Clock()
    hub, sent = make_hub(clock, l0=L0Stage(JudgeConfig(), tracker_factory=factory))
    hub.on_result(result(0, deer()))
    hub.on_result(result(100, deer()))
    assert [f["deer"] for f in sent] == [False, True]
    assert len(calls) >= 3  # 1 回目の作り直しが失敗しても、次で作り直す
    on = [e for e in named(logbuf, "flag.sent") if e["deer"]]
    assert on[0]["track_id"] is None


# RULE-1h
def test_rule1h_トラッカーの例外が続いてもログは1秒に1回まで_IDは続きから(logbuf):
    made = []

    def factory(first_id):
        made.append(first_id)
        return Boom(first_id)

    l0 = L0Stage(JudgeConfig(), tracker_factory=factory)
    for i in range(20):  # 0.1 秒おきに 2 秒
        l0.update(result(i * 100, deer()), i * 0.1)
    assert len(named(logbuf, "l0.tracker_failed")) == 2
    assert l0.primary_metrics(2.0) is None
    assert set(made) == {1}

    # 作り直したトラッカーの ID は続きから（再利用しない）
    l0 = L0Stage(JudgeConfig())
    l0.update(result(0, deer(x=0.2), deer(x=0.8)), 0.0)
    assert l0.tracker.next_id == 3
    broken = l0.tracker

    def fail(_result):
        raise ValueError("once")

    broken.update = fail
    l0.update(result(100, deer()), 0.1)
    assert l0.tracker is not broken and l0.tracker.next_id == 3
    l0.update(result(200, deer()), 0.2)
    assert [t.id for t in l0.tracker.tracks] == [3]
