"""capture.service（docs/specs/edge-capture UC-7・AC-1）: つなぎ。結果は先に下流へ渡る。

Test List: AC-1 WIRE-1a WIRE-1b WIRE-1c
"""

from __future__ import annotations

import json
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from detector.capture.http import CaptureApi
from detector.capture.jpeg import EncodeError
from detector.capture.service import CaptureService
from detector.config import CaptureConfig, CaptureServerConfig, Config, JudgeConfig, load_config
from detector.frame import Frame
from detector.hub import AlertHub
from detector.inference import ScriptedDetector
from detector.pipeline import FrameResult, process_frames
from detector.ports import Detection

from .conftest import T0, Clock, frames_at_fps

JST = timezone(timedelta(hours=9))
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00fake\xff\xd9"
DEER = Detection("deer", 0.9, (0.5, 0.5, 0.1, 0.2))


class ListSource:
    """最小の FrameSource（Frame の列を順に返す）。"""

    def __init__(self, frames: list[Frame]) -> None:
        self.frames = list(frames)

    def read(self) -> Frame | None:
        return self.frames.pop(0) if self.frames else None


class Encoder:
    def __init__(self, fail: bool = False) -> None:
        self.fail = fail

    def encode(self, image: np.ndarray, quality: int) -> bytes:
        if self.fail:
            msg = "boom"
            raise EncodeError(msg)
        return JPEG


def config_for(tmp_path: Path, **capture: object) -> Config:
    cfg = Config(
        capture=CaptureConfig(dir=str(tmp_path / "captures"), min_interval_s=0.5, **capture),  # type: ignore[arg-type]
        capture_server=CaptureServerConfig(port=0),
    )
    return replace(cfg, source_dir=str(tmp_path))


def results(count: int, conf: float = 0.9) -> list[FrameResult]:
    out = []
    for i in range(count):
        out.append(
            FrameResult(
                i,
                datetime(2027, 2, 15, 16, 30, 0, tzinfo=JST) + timedelta(seconds=i),
                [Detection("deer", conf, (0.4, 0.5, 0.05, 0.1))],
                5.0,
                image=np.full((480, 640, 3), 9, dtype=np.uint8),
            )
        )
    return out


def test_WIRE_1a_wrapは結果を同じ順で返しofferは返したあとに呼ぶ(tmp_path: Path) -> None:
    service = CaptureService.from_config(config_for(tmp_path), encoder=Encoder())
    assert service is not None
    order: list[str] = []
    real_offer = service.recorder.offer

    def spy(result: FrameResult) -> bool:
        order.append(f"offer{result.seq}")
        return real_offer(result)

    service.recorder.offer = spy  # type: ignore[method-assign]
    got = []
    for r in service.wrap(iter(results(3))):
        order.append(f"got{r.seq}")
        got.append(r.seq)
    assert got == [0, 1, 2]
    # 下流が受け取ってから offer（赤の判定のあとに保存を考える）。最後の 1 枚の offer は
    # 次のフレームを要求されたときに走るので、入力が尽きれば呼ばれることもある
    assert order.index("got0") < order.index("offer0")
    assert order.index("got1") < order.index("offer1")
    service.close()


def test_WIRE_1a_offerが例外でもイテレータは続く(tmp_path: Path) -> None:
    service = CaptureService.from_config(config_for(tmp_path), encoder=Encoder())
    assert service is not None

    def broken(_: FrameResult) -> bool:
        msg = "offer bug"
        raise RuntimeError(msg)

    service.recorder.offer = broken  # type: ignore[method-assign]
    assert [r.seq for r in service.wrap(iter(results(4)))] == [0, 1, 2, 3]
    service.close()


def test_WIRE_1a_wrapは入力の生成器を閉じる(tmp_path: Path) -> None:
    service = CaptureService.from_config(config_for(tmp_path), encoder=Encoder())
    assert service is not None
    closed = []

    def source():  # type: ignore[no-untyped-def]
        try:
            yield from results(5)
        finally:
            closed.append(True)

    wrapped = service.wrap(source())
    next(wrapped)
    wrapped.close()
    assert closed == [True]
    service.close()


def test_WIRE_1b_enabledがfalseならNone(tmp_path: Path) -> None:
    config = Config(capture=CaptureConfig(enabled=False))
    assert CaptureService.from_config(config) is None


def test_WIRE_1c_process_framesは成功したフレームに640x480の画像を付ける() -> None:
    config = Config()
    out = list(
        process_frames(
            ListSource(frames_at_fps(10, 3, width=64, height=48)),
            config,
            ScriptedDetector([[DEER]] * 3),
        )
    )
    assert len(out) == 3
    assert all(r.image is not None and r.image.shape == (480, 640, 3) for r in out)

    class Boom:
        def detect(self, image: np.ndarray) -> list[Detection]:
            msg = "infer"
            raise RuntimeError(msg)

    failed = list(process_frames(ListSource(frames_at_fps(10, 2)), config, Boom()))
    assert len(failed) == 2
    assert all(r.failed and r.image is None for r in failed)


def test_WIRE_1c_FrameResultの等しさは画像に影響されない() -> None:
    a = FrameResult(1, T0, [], 1.0, image=np.zeros((2, 2, 3), dtype=np.uint8))
    b = FrameResult(1, T0, [], 1.0, image=np.ones((2, 2, 3), dtype=np.uint8))
    assert a == b
    assert "image" not in repr(a)


def test_CFG_設定ファイルから作れる(tmp_path: Path) -> None:
    path = tmp_path / "detector.toml"
    path.write_text(
        f'[capture]\ndir = "{tmp_path / "c"}"\n[capture_server]\nport = 8767\n', encoding="utf-8"
    )
    service = CaptureService.from_config(load_config(path), encoder=Encoder())
    assert service is not None
    assert (tmp_path / "c").is_dir()
    service.close()


def test_AC_1_検知フレームの保存から一覧と画像と同意と送信済みまで(tmp_path: Path) -> None:
    service = CaptureService.from_config(config_for(tmp_path), encoder=Encoder())
    assert service is not None
    hub_flags: list[dict] = []
    clock = Clock()
    hub = AlertHub(JudgeConfig(), clock=clock)
    hub.sender = lambda text: hub_flags.append(json.loads(text)) or 1
    for r in service.wrap(iter(results(6))):
        clock.advance(0.1)
        hub.on_result(r)
    assert service.recorder.flush()
    api: CaptureApi = service.api
    host = {"host": "ezoroad.local:8767"}
    listing = api.handle("GET", "/captures?pending=1", host, b"")
    data = json.loads(listing.body)
    assert listing.status == 200
    assert data["total"] >= 4  # 6 枚のうち、最後の 1 枚は offer されないことがある
    assert data["idleSeconds"] is not None
    first = data["items"][0]["capture"]
    assert first["source"] == "vehicle"
    assert first["imageSize"] == [320, 240]
    assert first["consent"] is False
    ids = [i["capture"]["id"] for i in data["items"]]
    image_res = api.handle("GET", f"/captures/{ids[0]}/image", host, b"")
    assert (image_res.status, image_res.body) == (200, JPEG)
    json_headers = {**host, "content-type": "application/json", "content-length": "1000"}

    def post(path: str, payload: dict) -> dict:
        body = json.dumps(payload).encode()
        headers = {**json_headers, "content-length": str(len(body))}
        return json.loads(api.handle("POST", path, headers, body).body)

    assert post("/captures/consent", {"consent": True, "ids": ids})["updated"] == len(ids)
    after = json.loads(api.handle("GET", "/captures?pending=1", host, b"").body)
    assert all(i["capture"]["consent"] is True for i in after["items"])
    assert post("/captures/uploaded", {"ids": ids[:2]})["updated"] == 2
    final = json.loads(api.handle("GET", "/captures", host, b"").body)
    assert [i["uploaded"] for i in final["items"]].count(True) == 2
    assert json.loads(api.handle("GET", "/captures?pending=1", host, b"").body)["total"] == (
        len(ids) - 2
    )
    service.close()
    # 赤の判定は保存と無関係（同じ入力で、保存なしでも同じフラグ列）
    plain_flags: list[dict] = []
    clock2 = Clock()
    hub2 = AlertHub(JudgeConfig(), clock=clock2)
    hub2.sender = lambda text: plain_flags.append(json.loads(text)) or 1
    for r in results(6):
        clock2.advance(0.1)
        hub2.on_result(r)
    key = lambda f: (f["deer"], f.get("distanceM"), f.get("side"))  # noqa: E731
    assert [key(f) for f in hub_flags] == [key(f) for f in plain_flags]


def test_AC_1_保存が失敗しても赤の判定は変わらない(tmp_path: Path) -> None:
    flags: dict[str, list[dict]] = {}
    for name, fail in (("ok", False), ("broken", True)):
        service = CaptureService.from_config(
            config_for(tmp_path / name), encoder=Encoder(fail=fail)
        )
        assert service is not None
        out: list[dict] = []
        clock = Clock()
        hub = AlertHub(JudgeConfig(), clock=clock)
        hub.sender = lambda text, out=out: out.append(json.loads(text)) or 1
        for r in service.wrap(iter(results(6))):
            clock.advance(0.1)
            hub.on_result(r)
        service.close()
        flags[name] = [{k: v for k, v in f.items() if k != "t_sent"} for f in out]
    assert flags["ok"] == flags["broken"]
    assert any(f["deer"] for f in flags["ok"])


def test_AC_1_ソケットで待ち受けて標準クライアントで一覧が取れる(tmp_path: Path) -> None:
    import http.client

    service = CaptureService.from_config(config_for(tmp_path), encoder=Encoder())
    assert service is not None
    port = service.start()
    try:
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
        conn.request("GET", "/captures")
        response = conn.getresponse()
        assert response.status == 200
        assert json.loads(response.read())["items"] == []
        conn.close()
    finally:
        service.close()
    service.close()  # 2 回呼んでも壊れない
