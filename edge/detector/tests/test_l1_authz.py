"""AUTH-1〜9: threat.md の認可マトリクスの ❌ セル（edge-l1）。

L1 は降格だけ。数値と設定は変えられない。
"""

import asyncio
import contextlib
import json

from detector.config import Config, JudgeConfig, L1Config
from detector.hub import AlertHub
from detector.l1 import start_l1
from detector.l1.calibration import Calibration, load_calibration
from detector.l1.client import make_client
from detector.l1.runner import run_l1

from .conftest import Clock, deer, named, result
from .l1_fakes import MODEL, FakeClient, JevServer, answer, jev_body

IDS = ("alert_level", "on_roadway", "static_shoulder", "false_positive")
CAL = Calibration(MODEL, dict.fromkeys(IDS, 1.0))


def red_hub(**l1):
    clock = Clock()
    hub = AlertHub(JudgeConfig(), clock=clock, l1=L1Config(**l1))
    sent = []
    hub.sender = lambda t: sent.append(json.loads(t)) or 1
    for i in range(2):
        clock.advance(0.1)
        hub.on_result(result(100 * i, deer(0.9, x=0.4)))
    return hub, sent, clock


def run_once(hub, client, cal=CAL, n=2):
    sleeps = []

    async def fake_sleep(s):
        sleeps.append(s)
        await asyncio.sleep(0)

    async def main():
        task = asyncio.create_task(
            run_l1(hub, client, L1Config(), cal, clock=Clock(), sleep=fake_sleep)
        )
        while len(sleeps) < n:
            await asyncio.sleep(0)
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    asyncio.run(asyncio.wait_for(main(), 10))


# AUTH-1
def test_auth1_ループバックでない接続先には送らない(logbuf):
    jev = JevServer()
    for url in ("https://api.typesafe.ai", "http://192.168.1.20:8766", "http://ezoroad.local:8766"):
        hub = AlertHub(JudgeConfig(), l1=L1Config())
        assert (
            start_l1(Config(), hub, environ={"TYPESAFE_BASE_URL": url}, transport=jev.transport)
            is None
        )
        assert named(logbuf, "l1_unavailable")[-1]["reason"] == "remote_not_allowed"
    remote_cfg = Config(l1=L1Config(base_url="https://api.typesafe.ai"))
    assert start_l1(remote_cfg, AlertHub(JudgeConfig(), l1=remote_cfg.l1), environ={}) is None
    try:
        make_client("https://api.typesafe.ai", 800, {}, jev.transport)
    except Exception as exc:  # noqa: BLE001
        assert getattr(exc, "reason", None) == "remote_not_allowed"
    assert jev.requests == []


# AUTH-2
def test_auth2_答えだけでは赤は下がらない():
    hub, sent, _ = red_hub()
    run_once(hub, FakeClient([answer(false_positive=0.99)]), cal=None)  # 校正なし
    assert sent[-1]["deer"] is True
    clock = Clock()
    hub2 = AlertHub(JudgeConfig(), clock=clock, l1=L1Config())
    sent2 = []
    hub2.sender = lambda t: sent2.append(json.loads(t)) or 1
    for i in range(2):  # 閾値以上の鹿が 2 頭（赤の候補が 2 つ）
        clock.advance(0.1)
        hub2.on_result(result(100 * i, deer(0.9, x=0.2), deer(0.9, x=0.8)))
    run_once(hub2, FakeClient([answer(false_positive=0.99)]))
    assert sent2[-1]["deer"] is True


# AUTH-3・AUTH-6・AUTH-8
def test_auth3_6_8_端末のメッセージで赤は上下せず設定も変わらない():
    hub, sent, _ = red_hub()
    before = (hub._cfg, hub.fusion._cfg, hub.fusion.ttl_s)
    messages = [
        {"type": "ack", "t_shown": "2027-02-15T07:31:08.400+00:00"},
        {"type": "label", "value": "not_deer"},
        {"type": "flag", "v": 1, "deer": False, "zone": "outside"},
        {"type": "config", "l1": {"override_conf": 0.1}, "threshold": 0.1},
        {"type": "l1", "alert_level": "none", "conf": 1.0, "overrode": True, "latencyMs": 1},
    ]
    for m in messages:
        hub.on_client_message(json.dumps(m))
    assert sent[-1]["deer"] is True and hub.deer_on
    assert (hub._cfg, hub.fusion._cfg, hub.fusion.ttl_s) == before
    off = AlertHub(JudgeConfig(), clock=Clock(), l1=L1Config())
    off_sent = []
    off.sender = lambda t: off_sent.append(json.loads(t)) or 1
    off.on_result(result(0))
    for m in messages:
        off.on_client_message(json.dumps({**m, "deer": True}))
    assert all(not f["deer"] for f in off_sent)


# AUTH-4
def test_auth4_赤に戻すとき数値はL0の値():
    hub, sent, _ = red_hub()
    run_once(hub, FakeClient([answer(false_positive=0.99), answer()]), n=3)
    back = sent[-1]
    assert back["deer"] is True
    assert (back["distanceM"], back["side"], back["conf"]) == (16, "L", 0.9)


# AUTH-5
def test_auth5_L0が赤でないときdangerでも赤にならない():
    clock = Clock()
    hub = AlertHub(JudgeConfig(), clock=clock, l1=L1Config())
    sent = []
    hub.sender = lambda t: sent.append(json.loads(t)) or 1
    hub.on_result(result(0, deer(0.6, x=0.45)))  # 0.8 未満: 赤でない
    danger = answer(levels={"none": 0.0, "zone": 0.01, "danger": 0.99}, on_roadway=0.99)
    run_once(hub, FakeClient([danger]), n=3)
    assert all(not f["deer"] for f in sent)
    clock.advance(1.0)
    hub.tick()
    assert sent[-1]["deer"] is False and "l1" not in sent[-1]


# AUTH-7
def test_auth7_答えの余分な項目で設定は変わらない():
    body = jev_body(false_positive=0.1)
    body.update(override_conf=0.1, base_url="https://evil.example", threshold=0.0)
    body["answers"]["false_positive"]["override"] = True
    jev = JevServer(body=body)

    async def main():
        client = make_client("http://127.0.0.1:8766", 800, {}, jev.transport)
        hub, sent, _ = red_hub()
        before = (hub._cfg, hub.fusion._cfg)
        task = asyncio.create_task(run_l1(hub, client, L1Config(), CAL))
        while not jev.requests:
            await asyncio.sleep(0.01)
        await asyncio.sleep(0.05)
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
        await client.aclose()
        return hub, sent, before

    hub, sent, before = asyncio.run(asyncio.wait_for(main(), 10))
    assert (hub._cfg, hub.fusion._cfg) == before
    assert sent[-1]["deer"] is True


# AUTH-9
def test_auth9_calibration_jsonは読むだけ(tmp_path):
    temps = dict.fromkeys(IDS, 1.0)
    path = tmp_path / "calibration.json"
    path.write_text(json.dumps({"version": 1, "model": MODEL, "temperatures": temps}), "utf-8")
    before = (path.read_bytes(), path.stat().st_mtime_ns)
    cal = load_calibration(path)
    hub, _, _ = red_hub()
    run_once(hub, FakeClient([answer(false_positive=0.99)]), cal=cal, n=3)
    assert (path.read_bytes(), path.stat().st_mtime_ns) == before
    assert list(tmp_path.iterdir()) == [path]
