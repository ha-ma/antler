"""RQ-5・CAL-5n・CFG-6: vehicle を L1 の問い合わせの state に使う（pwa-uplink R5・R6）。"""

from __future__ import annotations

import asyncio
import contextlib
import json
from pathlib import Path

import pytest

from detector.config import Config, ConfigError, JudgeConfig, L1Config, load_config
from detector.hub import AlertHub
from detector.l1.calibration import Calibration, load_calibration
from detector.l1.request import VehicleContext, build_request, context_from_report
from detector.l1.runner import run_l1
from detector.vehicle import VehicleReport

from .conftest import Clock, deer, named, result
from .l1_fakes import MODEL, FakeClient, answer

EXAMPLE = Path(__file__).resolve().parents[1] / "config.example.toml"
FIXED = VehicleContext()
IDS = ("alert_level", "on_roadway", "static_shoulder", "false_positive")


def report(speed=None, zone=None, light=None, t=0.0) -> VehicleReport:
    return VehicleReport(speed, zone, light, t)


def cal(context: str | None = None) -> Calibration:
    temps = dict.fromkeys(IDS, 1.0)
    return Calibration(MODEL, temps) if context is None else Calibration(MODEL, temps, context)


def make_hub(**l1):
    clock = Clock()
    config = L1Config(**l1)
    hub = AlertHub(JudgeConfig(), clock=clock, l1=config)
    hub.sender = lambda _t: 1
    return hub, clock, config


def red(hub, clock):
    for i in range(2):
        clock.advance(0.1)
        hub.on_result(result(100 * i, deer(0.9)))


def send(hub, **kw) -> None:
    hub.on_client_message(json.dumps({"type": "vehicle", **kw}))


async def _ask(hub, clock, config, calibration):
    """run_l1 を最初の問い合わせが出るまで回してキャンセルし、受けた JudgeRequest を返す。"""
    client = FakeClient([answer()])

    async def fast_sleep(_s: float) -> None:
        await asyncio.sleep(0.001)

    task = asyncio.create_task(
        run_l1(hub, client, config, calibration, clock=clock, sleep=fast_sleep)
    )
    for _ in range(200):
        await asyncio.sleep(0.005)
        if client.requests:
            break
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task
    return client.requests


def ask(hub, clock, config, calibration=None):
    return asyncio.run(_ask(hub, clock, config, calibration))


def state_of(request) -> tuple:
    s = request.state
    return (s.speedKmh, s.zone, s.light, s.headlight)


# RQ-5i
def test_rq5i_VehicleContextの引数なしの既定は固定値のまま():
    assert (FIXED.speed_kmh, FIXED.zone, FIXED.light, FIXED.headlight) == (
        60.0,
        "inside",
        "night",
        "low",
    )


# RQ-5a・RQ-5b・RQ-5f・RQ-5g・RQ-5m（変換の純粋な部分）
def test_rq5_項目ごとに実値か固定値かを決めstate_sourceを返す():
    ctx, source = context_from_report(report(45.0, "outside", "dusk"))
    assert (ctx.speed_kmh, ctx.zone, ctx.light, ctx.headlight) == (45.0, "outside", "dusk", "low")
    assert source == "pwa"
    ctx, source = context_from_report(report(None, "outside", None))
    assert (ctx.speed_kmh, ctx.zone, ctx.light) == (60.0, "outside", "night")
    assert source == "partial"
    for empty in (None, report()):
        assert context_from_report(empty) == (FIXED, "fixed")


# RQ-5g
@pytest.mark.parametrize(
    ("real", "sent"),
    [(0.0, 30.0), (12.0, 30.0), (29.9, 30.0), (30.0, 30.0), (45.0, 45.0), (300.0, 300.0)],
)
def test_rq5g_速度は学習の下限30で持ち上げる(real, sent):
    ctx, _ = context_from_report(report(real, None, None))
    assert ctx.speed_kmh == sent


# RQ-5m
@pytest.mark.parametrize(
    ("light", "headlight"),
    [("day", "off"), ("dawn", "low"), ("dusk", "low"), ("night", "low"), (None, "low")],
)
def test_rq5m_ヘッドライトは光からの推定(light, headlight):
    ctx, _ = context_from_report(report(50.0, "inside", light))
    assert ctx.headlight == headlight


# RQ-5a
def test_rq5a_実値のstateはJudgeRequestに通る():
    hub, clock, _ = make_hub()
    red(hub, clock)
    picked = hub.l1_target()
    assert picked is not None
    target, recent = picked
    ctx, _ = context_from_report(report(300.0, "outside", "dawn"))
    request = build_request(target, recent, "jev-latest", ctx)
    assert state_of(request) == (300.0, "outside", "dawn", "low")


# RQ-5a・RQ-5h（校正なし → 実値）
def test_rq5h_校正なしでは実値を問い合わせに使いl1_resultにstate_sourceを残す(logbuf):
    hub, clock, cfg = make_hub()
    red(hub, clock)
    send(hub, speedKmh=45, zone="outside", light="day")
    requests = ask(hub, clock, cfg)
    assert state_of(requests[0]) == (45.0, "outside", "day", "off")
    assert named(logbuf, "l1.result")[0]["state_source"] == "pwa"
    assert not named(logbuf, "l1.vehicle_ignored")


def case(calibration=None, vehicle=None, after_s=0.0, **l1):
    """1 回だけ聞いたときの (state, 直近の l1.result)。鹿は見え続けている。"""
    hub, clock, cfg = make_hub(**l1)
    red(hub, clock)
    if vehicle is not None:
        send(hub, **vehicle)
    if after_s:
        clock.advance(after_s)
        hub.on_result(result(500, deer(0.9)))
    return state_of(ask(hub, clock, cfg, calibration)[0])


# RQ-5l
def test_rq5l_校正のcontextがrealなら実値_fixedなら固定値で1回だけ知らせる(logbuf):
    live = {"speedKmh": 45, "zone": "outside", "light": "day"}
    assert case(cal("real"), live) == (45.0, "outside", "day", "off")
    assert named(logbuf, "l1.result")[0]["state_source"] == "pwa"
    assert not named(logbuf, "l1.vehicle_ignored")
    for calibration in (cal(), cal("fixed")):
        before = len(named(logbuf, "l1.vehicle_ignored"))
        assert case(calibration, live) == (60.0, "inside", "night", "low")
        assert len(named(logbuf, "l1.vehicle_ignored")) == before + 1  # run_l1 ごとに 1 回
    ignored = named(logbuf, "l1.vehicle_ignored")
    assert {e["reason"] for e in ignored} == {"calibration_fixed"}
    assert {r["state_source"] for r in named(logbuf, "l1.result")[-1:]} == {"fixed"}


# RQ-5b
def test_rq5b_一部だけ有るときは有る項目だけ実値(logbuf):
    hub, clock, cfg = make_hub()
    red(hub, clock)
    send(hub, zone="outside")
    assert state_of(ask(hub, clock, cfg)[0]) == (60.0, "outside", "night", "low")
    assert named(logbuf, "l1.result")[0]["state_source"] == "partial"


# RQ-5c・RQ-5f
def test_rq5c_届いていない報告と古い報告は固定値(logbuf):
    assert case() == (60.0, "inside", "night", "low")
    assert named(logbuf, "l1.result")[0]["state_source"] == "fixed"
    live = {"speedKmh": 45, "zone": "outside", "light": "day"}
    assert case(vehicle=live, after_s=10.5) == (60.0, "inside", "night", "low")
    assert len(named(logbuf, "vehicle.stale")) == 1


# RQ-5k
def test_rq5k_速度は3秒で古くなりゾーンと光は10秒まで使う(logbuf):
    live = {"speedKmh": 45, "zone": "outside", "light": "day"}
    assert case(vehicle=live, after_s=3.0) == (
        45.0,
        "outside",
        "day",
        "off",
    )  # ちょうど 3 秒は新しい
    assert case(vehicle=live, after_s=3.01) == (60.0, "outside", "day", "off")
    assert named(logbuf, "l1.result")[-1]["state_source"] == "partial"
    assert case(vehicle=live, after_s=10.0) == (
        60.0,
        "outside",
        "day",
        "off",
    )  # ちょうど 10 秒は新しい


# RQ-5e
def test_rq5e_vehicle_stateがfixedなら実値が届いても固定値(logbuf):
    hub, clock, cfg = make_hub(vehicle_state="fixed")
    red(hub, clock)
    send(hub, speedKmh=45, zone="outside", light="day")
    assert state_of(ask(hub, clock, cfg, cal("real"))[0]) == (60.0, "inside", "night", "low")
    assert named(logbuf, "l1.result")[0]["state_source"] == "fixed"
    assert not named(logbuf, "l1.vehicle_ignored")  # 設定で切っているので校正のせいではない


# RQ-5j
def test_rq5j_hubとfusionとvehicleはdetector_l1を読み込まない():
    import subprocess
    import sys

    code = (
        "import sys; import detector.hub, detector.fusion, detector.vehicle;"
        "bad=[m for m in sys.modules if m=='detector.l1' or m.startswith('detector.l1.')];"
        "sys.exit(1 if bad else 0)"
    )
    assert subprocess.run([sys.executable, "-c", code], check=False).returncode == 0  # noqa: S603


# CAL-5n
def test_cal5n_calibration_jsonのcontext(tmp_path, logbuf):
    base = {"version": 1, "model": MODEL, "temperatures": dict.fromkeys(IDS, 1.0)}

    def load(extra):
        p = tmp_path / "calibration.json"
        p.write_text(json.dumps({**base, **extra}), encoding="utf-8")
        return load_calibration(p)

    assert load({}).context == "fixed"
    assert load({"context": "fixed"}).context == "fixed"
    assert load({"context": "real"}).context == "real"
    for bad in ("live", "", None, True, 1, ["real"]):
        assert load({"context": bad}) is None, bad
    assert named(logbuf, "l1.calibration_unavailable")[-1]["reason"] == "invalid"


def write(tmp_path, text: str) -> Path:
    p = tmp_path / "detector.toml"
    p.write_text(text, encoding="utf-8")
    return p


# CFG-6a
def test_cfg6a_既定と指定(tmp_path):
    l1 = load_config(write(tmp_path, "")).l1
    assert (l1.vehicle_state, l1.vehicle_max_age_s) == ("pwa", 10.0)
    l1 = load_config(write(tmp_path, '[l1]\nvehicle_state = "fixed"\nvehicle_max_age_s = 3\n')).l1
    assert (l1.vehicle_state, l1.vehicle_max_age_s) == ("fixed", 3.0)


# CFG-6c
@pytest.mark.parametrize(
    ("text", "key"),
    [
        ('[l1]\nvehicle_state = "live"\n', "l1.vehicle_state"),
        ("[l1]\nvehicle_state = true\n", "l1.vehicle_state"),
        ("[l1]\nvehicle_max_age_s = 0.9\n", "l1.vehicle_max_age_s"),
        ("[l1]\nvehicle_max_age_s = 60.1\n", "l1.vehicle_max_age_s"),
        ('[l1]\nvehicle_max_age_s = "10"\n', "l1.vehicle_max_age_s"),
    ],
)
def test_cfg6c_不正はキー名つきのConfigError(tmp_path, text, key):
    with pytest.raises(ConfigError, match=key.replace(".", r"\.")):
        load_config(write(tmp_path, text))


# CFG-6d
def test_cfg6d_見本が読め既定値と一致する():
    text = EXAMPLE.read_text(encoding="utf-8")
    assert "vehicle_state" in text and "vehicle_max_age_s" in text
    assert load_config(EXAMPLE) == Config()
