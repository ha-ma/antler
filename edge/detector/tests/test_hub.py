"""UC-4・UC-6・S-1〜S-5・IDEM-1: 配信の規則と ack の計測。"""

import json
from datetime import timedelta

from detector.config import JudgeConfig
from detector.hub import AlertHub

from .conftest import T0, Clock, deer, events, named, result


class Sink:
    def __init__(self, clients: int = 1) -> None:
        self.sent: list[dict] = []
        self.clients = clients

    def __call__(self, text: str) -> int:
        self.sent.append(json.loads(text))
        return self.clients


def make(**kw):
    clock = Clock()
    sink = Sink()
    hub = AlertHub(JudgeConfig(**kw), clock=clock, wall=lambda: T0 + timedelta(seconds=clock.t))
    hub.sender = sink
    return hub, clock, sink


def go_on(hub, clock, start=0):
    hub.on_result(result(start, deer()))
    clock.advance(0.1)
    hub.on_result(result(start + 100, deer()))


# UC-4a・S-1
def test_uc4a_判定が無いあいだは何も送らない(logbuf):
    hub, clock, sink = make()
    for _ in range(30):
        clock.advance(0.1)
        hub.tick()
    assert sink.sent == [] and hub.snapshot() is None
    assert not named(logbuf, "flag.sent")


# UC-4b
def test_uc4b_変化は即時に送る(logbuf):
    hub, clock, sink = make()
    hub.on_result(result(0))  # 最初の判定（鹿なし）
    go_on(hub, clock)
    assert [f["deer"] for f in sink.sent] == [False, True]
    assert {e["reason"] for e in named(logbuf, "flag.sent")} == {"change"}
    clock.advance(0.1)
    hub.on_result(result(200, deer()))
    hub.on_result(result(300, deer(x=0.9)))
    clock.advance(0.1)
    hub.on_result(result(400, deer(x=0.9)))
    assert sink.sent[-1]["side"] == "R"  # 2 フレーム続いて方向が変わった
    hub.on_result(result(5000))
    assert sink.sent[-1]["deer"] is False


# UC-4c・S-2
def test_uc4c_変化なしは1秒ごと_距離はハートビートで運ぶ(logbuf):
    hub, clock, sink = make()
    go_on(hub, clock)
    n = len(sink.sent)
    clock.advance(0.5)
    hub.on_result(result(600, deer(h=0.2)))
    hub.tick()
    assert len(sink.sent) == n  # 距離だけの変化は即時に送らない
    clock.advance(0.5)
    hub.on_result(result(700, deer(h=0.2)))
    hub.tick()
    assert len(sink.sent) == n + 1
    assert sink.sent[-1]["distanceM"] == 8
    assert named(logbuf, "flag.sent")[-1]["reason"] == "heartbeat"


# UC-4g
def test_uc4g_ハートビートのt_frameは状態のt_frameでt_sentだけ新しい():
    hub, clock, sink = make()
    go_on(hub, clock)
    first = sink.sent[-1]
    clock.advance(0.6)
    hub.on_result(result(700, deer()))
    clock.advance(0.5)
    hub.tick()
    beat = sink.sent[-1]
    assert beat["t_frame"] != first["t_frame"] and beat["t_sent"] > first["t_sent"]
    assert beat["t_frame"] == "2027-02-15T16:31:08.700+09:00"


# UC-4d
def test_uc4d_新しい接続に直近の判定を1回(logbuf):
    hub, clock, _ = make()
    go_on(hub, clock)
    text = hub.snapshot()
    assert json.loads(text)["deer"] is True
    assert named(logbuf, "flag.sent")[-1]["reason"] == "snapshot"


# UC-4e
def test_uc4e_expireが1_5秒後にOFFを送る():
    hub, clock, sink = make()
    go_on(hub, clock)
    clock.advance(1.4)
    hub.tick()
    assert sink.sent[-1]["deer"] is True
    clock.advance(0.2)
    hub.tick()
    assert sink.sent[-1]["deer"] is False


# UC-4f
def test_uc4f_成功フレームが3秒来ないとハートビートを止める(logbuf):
    hub, clock, sink = make()
    go_on(hub, clock)
    for _ in range(10):  # OFF のあとも 1 秒おきに tick
        clock.advance(0.5)
        hub.tick()
    after_off = len(sink.sent)
    assert sink.sent[-1]["deer"] is False
    for _ in range(20):
        clock.advance(0.5)
        hub.tick()
    assert len(sink.sent) == after_off
    assert len(named(logbuf, "judge.stalled")) == 1
    hub.on_result(result(20_000))  # 戻れば再開
    clock.advance(1.0)
    hub.tick()
    assert sink.sent[-1]["deer"] is False and len(sink.sent) > after_off


def test_uc4f_失敗が続くときも止める():
    hub, clock, sink = make()
    hub.on_result(result(0))
    for i in range(1, 12):
        clock.advance(0.5)
        hub.on_result(result(i * 500, failed=True))
        hub.tick()
    beats = len(sink.sent)
    for i in range(12, 20):
        clock.advance(0.5)
        hub.on_result(result(i * 500, failed=True))
        hub.tick()
    assert len(sink.sent) == beats


# UC-6a
def test_uc6a_ackはONにした最初のt_frameと組になる(logbuf):
    hub, clock, _ = make()
    go_on(hub, clock)
    clock.advance(2.0)
    hub.tick()  # OFF になっても残る
    t_shown = T0 + timedelta(milliseconds=100, seconds=5, hours=9)
    hub.on_client_message(
        json.dumps(
            {
                "type": "ack",
                "t_shown": t_shown.replace(tzinfo=None).isoformat() + "+09:00",
                "extra": 1,
            }
        )
    )
    ack = named(logbuf, "ack")[0]
    assert ack["t_frame"] == "2027-02-15T16:31:08.100+09:00"
    assert ack["since_frame_ms"] == 5000.0
    assert ack["t_shown"].endswith("+09:00")


def test_uc6a_ONが無ければnull(logbuf):
    hub, _, _ = make()
    hub.on_client_message(json.dumps({"type": "ack", "t_shown": "2027-02-15T16:31:08.100+09:00"}))
    ack = named(logbuf, "ack")[0]
    assert ack["t_frame"] is None and ack["since_frame_ms"] is None


# UC-6b
def test_uc6b_t_shownが不正なら捨てて本文を残さない(logbuf):
    hub, _, _ = make()
    for bad in ("2027-02-15T16:31:08.100", "yesterday", 12345, None):
        hub.on_client_message(json.dumps({"type": "ack", "t_shown": bad}))
    assert len(named(logbuf, "ack.invalid")) == 4 and not named(logbuf, "ack")
    assert "yesterday" not in logbuf.getvalue()


# FAIL-6
def test_fail6_t_shownが未来でも落ちず負でも出る(logbuf):
    hub, clock, _ = make()
    go_on(hub, clock)
    hub.on_client_message(json.dumps({"type": "ack", "t_shown": "2027-02-15T16:31:07.000+09:00"}))
    assert named(logbuf, "ack")[0]["since_frame_ms"] < 0


def test_ignored_は型名だけ(logbuf):
    hub, _, _ = make()
    hub.on_client_message("not json")
    hub.on_client_message(json.dumps({"type": "flag", "deer": True, "secret": "SECRET-BODY"}))
    hub.on_client_message(json.dumps({"type": "x" * 100}))
    hub.on_client_message(b"\x00\x01")
    hub.on_client_message(json.dumps({"type": "label", "value": "present"}))
    ig = named(logbuf, "client.ignored")
    assert [e["type"] for e in ig] == [None, "flag", None, None]
    assert "SECRET-BODY" not in logbuf.getvalue()


# UC-6c
def test_uc6c_flag_sentの項目(logbuf):
    hub, clock, sink = make()
    sink.clients = 3
    go_on(hub, clock)
    e = named(logbuf, "flag.sent")[-1]
    assert {"t_frame", "t_sent", "deer", "reason", "clients"} <= set(e)
    assert e["clients"] == 3 and e["deer"] is True


# UC-6d
def test_uc6d_ログに画像や位置や本文が無い(logbuf):
    hub, clock, _ = make()
    go_on(hub, clock)
    hub.on_client_message(
        json.dumps({"type": "ack", "t_shown": "2027-02-15T16:31:08.100+09:00", "lat": 43.1})
    )
    banned = {"image", "pixels", "lat", "lng", "deviceId", "email", "frameJpegB64"}
    for e in events(logbuf):
        assert not banned & set(e)


# IDEM-1
def test_idem1_ハートビートを繰り返してもchangeは1回(logbuf):
    hub, clock, _ = make()
    go_on(hub, clock)
    for _ in range(25):
        clock.advance(0.1)
        hub.on_result(result(300, deer()))
        hub.tick()
    reasons = [e["reason"] for e in named(logbuf, "flag.sent")]
    assert reasons.count("change") == 2  # 最初の判定（鹿なし）と ON の 2 回だけ


# UC-4h
def test_uc4h_停止中の新しい接続にsnapshotを配らない_古いONはexpireしてから(logbuf):
    hub, clock, sink = make()
    go_on(hub, clock)
    clock.advance(1.6)  # ticker が止まっていても、snapshot が expire する
    assert json.loads(hub.snapshot())["deer"] is False  # 古い ON は配らず、先に OFF にする
    assert sink.sent[-1]["deer"] is False
    clock.advance(5.0)
    assert hub.snapshot() is None  # 3 秒以上見えていない


def test_uc4h_見えている間はsnapshotを配る():
    hub, clock, _ = make()
    go_on(hub, clock)
    clock.advance(0.2)
    hub.on_result(result(300, deer()))
    assert json.loads(hub.snapshot())["deer"] is True


# UC-4i
def test_uc4i_全部不正で捨てた出力は鹿なしと区別しハートビートを止める():
    from detector.pipeline import FrameResult

    hub, clock, sink = make()
    hub.on_result(result(0))
    for i in range(1, 12):
        clock.advance(0.5)
        hub.on_result(
            FrameResult(i, T0 + timedelta(milliseconds=i * 500), [], 5.0, invalid_count=3)
        )
        hub.tick()
    n = len(sink.sent)
    for i in range(12, 20):
        clock.advance(0.5)
        hub.on_result(
            FrameResult(i, T0 + timedelta(milliseconds=i * 500), [], 5.0, invalid_count=3)
        )
        hub.tick()
    assert len(sink.sent) == n and hub.snapshot() is None


# UC-6e
def test_uc6e_深いJSONと年9999のackで落ちない(logbuf):
    hub, _, _ = make()
    hub.on_client_message("[" * 100_000)
    hub.on_client_message(json.dumps({"type": "ack", "t_shown": "9999-12-31T23:59:59.999+00:00"}))
    assert len(named(logbuf, "client.ignored")) == 1
    assert len(named(logbuf, "ack.invalid")) == 1
