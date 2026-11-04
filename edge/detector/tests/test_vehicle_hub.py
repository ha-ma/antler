"""HV-4: vehicle の受信（docs/specs/pwa-uplink R4・R7）。保持・置き換え・無効の扱い・赤の経路。"""

from __future__ import annotations

import json

from detector.config import JudgeConfig, L1Config
from detector.hub import AlertHub
from detector.vehicle import VehicleReport

from .conftest import Clock, deer, named, result


def make_hub(clock: Clock | None = None, **l1):
    sent: list[dict] = []
    clock = clock or Clock()
    hub = AlertHub(JudgeConfig(), clock=clock, l1=L1Config(**l1))
    hub.sender = lambda t: sent.append(json.loads(t)) or 1
    return hub, sent, clock


def vehicle(**kw) -> str:
    return json.dumps({"type": "vehicle", **kw})


# HV-4a
def test_hv4a_有効なvehicleを保持し次のvehicleが全部を置き換える():
    hub, _, clock = make_hub()
    assert hub.vehicle_report(10.0) is None
    hub.on_client_message(vehicle(speedKmh=42, zone="outside", light="dusk"))
    assert hub.vehicle_report(10.0) == VehicleReport(42.0, "outside", "dusk", clock())
    clock.advance(1.0)
    hub.on_client_message(vehicle(zone="inside"))  # 速度と光は「分からない」に戻る
    assert hub.vehicle_report(10.0) == VehicleReport(None, "inside", None, clock())


# HV-4b
def test_hv4b_無効なvehicleは捨てて前の値と新しさを変えない(logbuf):
    hub, _, clock = make_hub()
    hub.on_client_message(vehicle(speedKmh=42, zone="inside"))
    first = hub.vehicle_report(10.0)
    assert first is not None
    clock.advance(2.0)
    for body in (
        vehicle(speedKmh=-1),
        vehicle(speedKmh="42"),
        vehicle(speedKmh=True),
        vehicle(zone="unknown"),
        vehicle(zone=None),
        vehicle(lat=43.1, lon=144.3),
        '{"type":"vehicle","speedKmh":NaN}',
        '{"type":"vehicle","speedKmh":Infinity}',
    ):
        hub.on_client_message(body)
    assert hub.vehicle_report(10.0) == first  # 値も received_at も変わらない（新しさは進まない）
    assert len(named(logbuf, "vehicle.invalid")) == 1  # 同じ秒の中では 1 回まで
    clock.advance(1.0)
    hub.on_client_message(vehicle(speedKmh=-1))
    assert len(named(logbuf, "vehicle.invalid")) == 2
    assert all(
        "lat" not in json.dumps(e) and "43.1" not in json.dumps(e)
        for e in named(logbuf, "vehicle.invalid")
    )


# HV-4c
def test_hv4c_複数の接続から交互に届いても最後の有効なものが勝つ():
    hub, _, clock = make_hub()
    hub.on_client_message(vehicle(speedKmh=10, zone="inside"))  # 端末 A
    clock.advance(0.2)
    hub.on_client_message(vehicle(speedKmh=80, zone="outside"))  # 端末 B
    clock.advance(0.2)
    hub.on_client_message(vehicle(speedKmh=-5))  # 端末 A の壊れたもの
    report = hub.vehicle_report(10.0)
    assert report is not None and (report.speed_kmh, report.zone) == (80.0, "outside")


# HV-4d
def test_hv4d_ackとlabelと未知の型の扱いは今までどおり(logbuf):
    hub, sent, _ = make_hub()
    hub.on_client_message(json.dumps({"type": "ack", "t_shown": "2027-02-15T16:31:08.360+09:00"}))
    hub.on_client_message(json.dumps({"type": "label", "value": "present"}))
    hub.on_client_message(json.dumps({"type": "position", "lat": 1, "lon": 2}))
    hub.on_client_message("not json")
    hub.on_client_message(b"\x00")
    assert named(logbuf, "ack")
    assert [e["type"] for e in named(logbuf, "client.ignored")] == ["position", None, None]
    assert hub.vehicle_report(10.0) is None
    assert sent == []


# HV-4e
def test_hv4e_vehicleの受信は赤の経路に触れない(logbuf):
    plain, plain_sent, plain_clock = make_hub()
    hub, sent, clock = make_hub()
    for h, c in ((plain, plain_clock), (hub, clock)):
        for i in range(2):
            c.advance(0.1)
            if h is hub:
                h.on_client_message(vehicle(speedKmh=0, zone="outside", light="day"))
            h.on_result(result(100 * i, deer(0.9, x=0.4)))
    strip = lambda flags: [{k: v for k, v in f.items() if k != "t_sent"} for f in flags]  # noqa: E731
    assert strip(sent) == strip(
        plain_sent
    )  # 赤の時刻・距離・方向・回数が vehicle の有無で変わらない
    assert sent and sent[-1]["deer"] is True
    before = list(sent)
    for _ in range(50):
        hub.on_client_message(vehicle(speedKmh=0, zone="outside"))  # 受信だけでは何も送らない
    assert sent == before
    assert hub.fusion is not None and hub.fusion.active is False


# HV-4f
def test_hv4f_vehicle_updatedはzoneかlightが変わったときだけ速度の値を出さない(logbuf):
    hub, _, clock = make_hub()
    hub.on_client_message(vehicle(speedKmh=42, zone="inside", light="day"))
    clock.advance(1.0)
    hub.on_client_message(vehicle(speedKmh=43, zone="inside", light="day"))  # 速度の値だけ違う
    clock.advance(1.0)
    hub.on_client_message(vehicle(speedKmh=43, zone="outside", light="day"))
    updates = named(logbuf, "vehicle.updated")
    assert [(u["zone"], u["light"]) for u in updates] == [("inside", "day"), ("outside", "day")]
    assert all(u["has_speed"] is True for u in updates)
    assert not {"speed", "speed_kmh", "speedKmh"} & {
        key for u in updates for key in u
    }  # 値は出ない


# RQ-5k（hub 側: 速度は 3 秒で古くなる。ゾーンと光は max_age まで）
def test_rq5k_速度だけ3秒で落ちる():
    hub, _, clock = make_hub()
    hub.on_client_message(vehicle(speedKmh=42, zone="inside", light="day"))
    clock.advance(3.0)
    assert hub.vehicle_report(10.0).speed_kmh == 42.0
    clock.advance(0.01)
    partial = hub.vehicle_report(10.0)
    assert (partial.speed_kmh, partial.zone, partial.light) == (None, "inside", "day")
    # max_age が 3 秒より短いなら、速度もそれまで（全部いっしょに古くなる）
    hub.on_client_message(vehicle(speedKmh=42, zone="inside"))
    clock.advance(2.0)
    assert hub.vehicle_report(2.0).speed_kmh == 42.0
    clock.advance(0.01)
    assert hub.vehicle_report(2.0) is None


# RQ-5c（hub 側: 古さ）
def test_rq5c_古くなったら返さずvehicle_staleを1回だけ残す(logbuf):
    hub, _, clock = make_hub()
    hub.on_client_message(vehicle(speedKmh=42, zone="inside", light="day"))
    clock.advance(10.0)
    assert hub.vehicle_report(10.0) is not None  # RQ-5d: ちょうど 10 秒は新しい
    clock.advance(0.01)
    assert hub.vehicle_report(10.0) is None
    assert hub.vehicle_report(10.0) is None
    assert len(named(logbuf, "vehicle.stale")) == 1
    hub.on_client_message(vehicle(zone="inside"))
    assert hub.vehicle_report(10.0) is not None
    clock.advance(11.0)
    assert hub.vehicle_report(10.0) is None
    assert len(named(logbuf, "vehicle.stale")) == 2  # 次に新しい値が来たあとの古さは、また 1 回


# FAIL-2
def test_fail2_時計が後ろへ戻っても新しい扱いで例外にしない():
    hub, _, clock = make_hub()
    hub.on_client_message(vehicle(speedKmh=42))
    clock.advance(-50.0)
    report = hub.vehicle_report(10.0)
    assert report is not None and report.speed_kmh == 42.0


# FAIL-3
def test_fail3_保持で例外が出てもon_client_messageは例外を出さない(logbuf, monkeypatch):
    hub, _, _ = make_hub()

    def boom(*_a, **_k):
        raise RuntimeError("boom")

    monkeypatch.setattr("detector.hub.parse_vehicle", boom)
    hub.on_client_message(vehicle(speedKmh=42))
    assert named(logbuf, "vehicle.error")[0]["error_type"] == "RuntimeError"
    assert hub.vehicle_report(10.0) is None
