"""edge-run の個別の振る舞い: 引数・走行ログ・起動前の検査・組み立て・停止・--check。"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import signal
import socket
from dataclasses import replace
from datetime import datetime
from pathlib import Path

import numpy as np
import pytest

from detector import app
from detector.config import ConfigError
from detector.ports import SourceError

from .app_fakes import (
    CONFIG_TEXT,
    FakeCamera,
    RestoreLogging,
    always_deer,
    make_config,
    write_config,
)
from .conftest import named


def run(coro):
    return asyncio.run(asyncio.wait_for(coro, 30))


def deps(camera: FakeCamera | None = None, **kw) -> app.Deps:
    cam = camera or FakeCamera()
    return app.Deps(load_detector=always_deer, open_source=lambda _c: cam, **kw)


async def serve_until(config, d, control, *, after=None, stop_timeout_s=app.STOP_TIMEOUT_S):
    """起動を待ち、after(info) を待ってから止める旗を立てる（after が None なら旗を立てない）。"""
    loop = asyncio.get_running_loop()
    ready = loop.create_future()
    task = asyncio.create_task(
        app.serve(config, d, control, ready=ready.set_result, stop_timeout_s=stop_timeout_s)
    )
    info = await asyncio.wait_for(ready, 5)
    if after is not None:
        await after(info)
        control.request()
    return info, await asyncio.wait_for(task, 15)


def busy_port() -> socket.socket:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    s.listen()
    return s


# ---- UC-1 引数とログ ----


# RUN-1a
def test_RUN_1a_no_l1とno_captureは該当のenabledだけを落とす(tmp_path):
    config = make_config(tmp_path, CONFIG_TEXT.replace("enabled = false", "enabled = true"))
    out = app.apply_overrides(config, no_l1=True, no_capture=True)
    assert out.l1.enabled is False and out.capture.enabled is False
    assert replace(out, l1=config.l1, capture=config.capture) == config
    assert app.apply_overrides(config) == config


# RUN-1a
def test_RUN_1a_configが無いと引数エラー(capsys):
    with pytest.raises(SystemExit) as exc:
        app.main([])
    assert exc.value.code == 2
    assert "--config" in capsys.readouterr().err


# RUN-1b
def test_RUN_1b_走行ログはlog_dirのrun_日時_jsonlでファイルはlevel以上_端末はWARNING以上(tmp_path):
    console = io.StringIO()
    at = datetime(2027, 2, 15, 16, 31, 8)
    with RestoreLogging():
        path = app.setup_logging(tmp_path / "logs", "INFO", console=console, now=lambda: at)
        log = logging.getLogger("detector.test")
        log.debug("debug.line")
        log.info("info.line", extra={"t_frame": "x"})
        log.warning("warn.line")
        again = app.setup_logging(tmp_path / "logs", "INFO", console=io.StringIO(), now=lambda: at)
    assert path == tmp_path / "logs" / "run-20270215-163108.jsonl"
    assert again == tmp_path / "logs" / "run-20270215-163108-1.jsonl"  # 上書きしない
    written = [json.loads(line)["event"] for line in path.read_text().splitlines()]
    assert written == ["info.line", "warn.line"]
    assert [json.loads(line)["event"] for line in console.getvalue().splitlines()] == ["warn.line"]


# RUN-1b
def test_RUN_1b_main_の既定のログの置き場所は設定ファイルの隣のlogs(tmp_path, monkeypatch):
    config = write_config(tmp_path)
    seen = {}

    def fake_setup(log_dir, level, **_kw):
        seen["dir"], seen["level"] = log_dir, level
        return log_dir / "run.jsonl"

    async def fake_run(*_a):
        return app.RunResult(0, "signal")

    monkeypatch.setattr(app, "setup_logging", fake_setup)
    monkeypatch.setattr(app, "_run", fake_run)
    monkeypatch.setattr(app, "install_excepthook", lambda: None)
    assert app.main(["--config", str(config), "--log-level", "DEBUG"]) == 0
    assert seen == {"dir": tmp_path / "logs", "level": "DEBUG"}
    assert app.main(["--config", str(config), "--log-dir", str(tmp_path / "x")]) == 0
    assert seen["dir"] == tmp_path / "x"


def test_RUN_1b_ログを書けないとexit2(tmp_path, capsys):
    config = write_config(tmp_path)
    blocker = tmp_path / "file"
    blocker.write_text("")
    assert app.main(["--config", str(config), "--log-dir", str(blocker / "logs")]) == 2
    assert "走行ログを書けない" in capsys.readouterr().err


# ---- UC-2 起動前の検査 ----


# RUN-2a
def test_RUN_2a_model_pathが空ならConfigError(tmp_path):
    config = make_config(tmp_path, "")
    with pytest.raises(ConfigError, match="model_path が空"):
        app.load_detector(config)


# RUN-2a
def test_RUN_2a_モデルが無いとmainはexit2でファイル名と手順書だけを出す(tmp_path, capsys):
    config = write_config(tmp_path)
    opened = []
    d = app.Deps(open_source=lambda c: opened.append(c))
    with RestoreLogging():
        code = app.main(["--config", str(config), "--log-dir", str(tmp_path / "logs")], deps=d)
    err = capsys.readouterr().err
    assert code == 2
    assert "モデルが無い: yolo26n-test.mlpackage" in err and app.RUNBOOK in err
    assert str(tmp_path / "models") not in err
    assert opened == []  # カメラより先に止まる


# RUN-2b
def test_RUN_2b_相対のmodel_pathとcamera_pathは設定ファイルのディレクトリから(
    tmp_path, monkeypatch
):
    model = tmp_path / "models" / "yolo26n-test.mlpackage"
    model.mkdir(parents=True)
    seen = {}
    monkeypatch.setattr(
        app, "load_coreml_detector", lambda c: seen.setdefault("model", c.infer.model_path)
    )
    monkeypatch.setattr(app, "open_video_file", lambda p: seen.setdefault("video", p))
    monkeypatch.chdir(Path("/"))
    config = make_config(
        tmp_path, CONFIG_TEXT + '\n[camera]\nsource = "file"\npath = "clips/run.mp4"\n'
    )
    app.load_detector(config)
    app.open_source(config)
    assert seen == {"model": str(model), "video": str(tmp_path / "clips" / "run.mp4")}


def test_RUN_2b_deviceはカメラを開く(tmp_path, monkeypatch):
    seen = []
    monkeypatch.setattr(app, "open_camera", lambda *a: seen.append(a))
    app.open_source(make_config(tmp_path))
    assert seen == [(0, 1280, 720, 60)]


# RUN-2c
def test_RUN_2c_設定の誤りはexit2(tmp_path, capsys):
    config = write_config(tmp_path, "[nope]\n")
    assert app.main(["--config", str(config)]) == 2
    assert "知らないセクション: nope" in capsys.readouterr().err


# RUN-2c
@pytest.mark.parametrize(
    ("error", "expect"),
    [
        (ConfigError("モデルのクラスに deer が無い"), "deer が無い"),
        (RuntimeError("bad"), "モデルを読めない: yolo26n-test.mlpackage（RuntimeError）"),
    ],
)
def test_RUN_2c_モデルの読み込みの失敗はStartupErrorでカメラを開かない(tmp_path, error, expect):
    opened = []

    def boom(_c):
        raise error

    d = app.Deps(load_detector=boom, open_source=lambda c: opened.append(c))
    with pytest.raises(app.StartupError, match=expect):
        run(app.serve(make_config(tmp_path), d, app.StopControl()))
    assert opened == []


# RUN-2c
def test_RUN_2c_カメラが開けないとStartupErrorで何も待ち受けない(tmp_path, logbuf):
    def boom(_c):
        raise SourceError("開けない: device:0")

    d = app.Deps(load_detector=always_deer, open_source=boom)
    with pytest.raises(app.StartupError, match="カメラを開けない: 開けない: device:0"):
        run(app.serve(make_config(tmp_path), d, app.StopControl()))
    assert named(logbuf, "server.listening") == []


# RUN-2d
def test_RUN_2d_WebSocketのポートが使用中ならexit2でカメラを閉じる(tmp_path):
    camera = FakeCamera()
    with busy_port() as s:
        config = make_config(tmp_path)
        config = replace(config, server=replace(config.server, port=s.getsockname()[1]))
        with pytest.raises(app.StartupError, match="待ち受けを始められない"):
            run(app.serve(config, deps(camera), app.StopControl()))
    assert camera.closed == 1


# RUN-2d
def test_RUN_2d_captureのポートが使用中ならWebSocketとカメラを閉じる(tmp_path, logbuf):
    camera = FakeCamera()
    with busy_port() as s:
        config = make_config(tmp_path)
        config = replace(
            config, capture_server=replace(config.capture_server, port=s.getsockname()[1])
        )
        with pytest.raises(app.StartupError, match="待ち受けを始められない"):
            run(app.serve(config, deps(camera), app.StopControl()))
    assert camera.closed == 1
    ws_port = named(logbuf, "server.listening")[0]["port"]
    with socket.socket() as c:
        assert c.connect_ex(("127.0.0.1", ws_port)) != 0


def test_RUN_2d_起動の失敗はmainでexit2とrun_stopped(tmp_path, capsys):
    camera = FakeCamera()
    with busy_port() as s:
        path = write_config(tmp_path, CONFIG_TEXT + f"\n[server]\nport = {s.getsockname()[1]}\n")
        with RestoreLogging():
            code = app.main(
                ["--config", str(path), "--log-dir", str(tmp_path / "logs")], deps=deps(camera)
            )
    assert code == 2 and "待ち受けを始められない" in capsys.readouterr().err
    log = next((tmp_path / "logs").glob("run-*.jsonl")).read_text()
    stopped = [json.loads(x) for x in log.splitlines() if '"run.stopped"' in x]
    assert stopped[0]["reason"] == "startup" and stopped[0]["code"] == 2


# ---- UC-3 組み立て ----


# RUN-3a
def test_RUN_3a_L1が有効ならcaptureのobserverを渡しbackgroundで動かす(tmp_path):
    config = make_config(tmp_path, CONFIG_TEXT.replace("enabled = false", "enabled = true"))
    calls = {}
    started = asyncio.Event()

    def fake_start_l1(cfg, hub, *, environ, observer):
        calls.update(enabled=cfg.l1.enabled, fusion=hub.fusion is not None, observer=observer)

        async def task():
            started.set()
            await asyncio.Event().wait()  # pump が片付けで取り消す

        return task()

    async def after(_info):
        await asyncio.wait_for(started.wait(), 5)

    d = deps(start_l1=fake_start_l1, environ={})
    info, result = run(serve_until(config, d, app.StopControl(), after=after))
    assert result.code == 0 and info.l1 is True
    assert calls["enabled"] and calls["fusion"]
    assert getattr(calls["observer"], "__name__", "") == "on_l1_answer"


# RUN-3a・S-1
def test_RUN_3a_local_jevが居なくても赤が届く(tmp_path, logbuf):
    with socket.socket() as s:  # 誰も待ち受けていないループバックのポート
        s.bind(("127.0.0.1", 0))
        free = s.getsockname()[1]
    text = CONFIG_TEXT.replace(
        "enabled = false", f'enabled = true\nbase_url = "http://127.0.0.1:{free}"'
    )
    config = make_config(tmp_path, text)

    async def after(info):
        from websockets.asyncio.client import connect

        async with connect(f"ws://127.0.0.1:{info.ws_port}/alerts") as ws:
            while not json.loads(await asyncio.wait_for(ws.recv(), 5))["deer"]:
                pass

    info, result = run(serve_until(config, deps(environ={}), app.StopControl(), after=after))
    assert result == app.RunResult(0, "signal") and info.l1 is True


# RUN-3b
def test_RUN_3b_captureが無効なら作らない(tmp_path):
    made = []

    def capture(cfg):
        made.append(cfg)
        return None

    config = app.apply_overrides(make_config(tmp_path), no_capture=True)

    async def after(_info):
        await asyncio.sleep(0.2)

    info, result = run(serve_until(config, deps(capture=capture), app.StopControl(), after=after))
    assert info.capture_port is None and result.code == 0
    assert made == [config]
    assert not (tmp_path / "captures").exists()


# ---- UC-4 停止 ----


# RUN-4a
def test_RUN_4a_止める旗で入力が終わり_captureからWebSocketからカメラの順に閉じる(tmp_path, logbuf):
    order = []
    camera = FakeCamera()
    real_close = camera.close
    camera.close = lambda: (order.append("camera"), real_close())

    def capture(cfg):
        from detector.capture.service import CaptureService

        service = CaptureService.from_config(cfg)
        inner = service.close
        service.close = lambda: (order.append("capture"), inner())
        return service

    async def after(_info):
        await asyncio.sleep(0.3)

    from detector.server import AlertServer

    real_stop = AlertServer.stop

    async def stop(self):
        order.append("ws")
        await real_stop(self)

    AlertServer.stop = stop
    try:
        _, result = run(
            serve_until(
                make_config(tmp_path), deps(camera, capture=capture), app.StopControl(), after=after
            )
        )
    finally:
        AlertServer.stop = real_stop
    assert result == app.RunResult(0, "signal")
    assert order == ["capture", "ws", "camera"]
    assert named(logbuf, "pipeline.summary")[0]["ended"] == "eof"


# RUN-4a
def test_RUN_4a_WebSocketの停止が失敗してもカメラを閉じる(tmp_path, logbuf, monkeypatch):
    from detector.server import AlertServer

    camera = FakeCamera()
    real_stop = AlertServer.stop

    async def stop(self):
        await real_stop(self)
        raise RuntimeError("boom")

    monkeypatch.setattr(AlertServer, "stop", stop)

    async def after(_info):
        await asyncio.sleep(0.2)

    _, result = run(
        serve_until(make_config(tmp_path), deps(camera), app.StopControl(), after=after)
    )
    assert result == app.RunResult(0, "signal")
    assert camera.closed == 1
    assert named(logbuf, "server.stop_failed")[0]["error_type"] == "RuntimeError"


# RUN-4b・S-4
def test_RUN_4b_readが戻らないと上限で取り消してforced(tmp_path, logbuf):
    camera = FakeCamera(block=True)

    async def after(_info):
        await asyncio.to_thread(camera.blocked.wait, 5)

    async def main():
        try:
            config = make_config(tmp_path)
            return await serve_until(
                config, deps(camera), app.StopControl(), after=after, stop_timeout_s=0.3
            )
        finally:
            camera.released.set()  # 実機は os._exit で抜ける。テストはスレッドを戻して終える

    _, result = run(main())
    assert result == app.RunResult(0, "forced")
    # read() の中のスレッドがいるカメラは解放しない（落ちうる）。入口は os._exit で抜ける
    assert camera.closed == 0
    assert named(logbuf, "camera.left_open")
    assert named(logbuf, "run.stopped")[0]["reason"] == "forced"


# RUN-4b
def test_RUN_4b_2回目の要求は上限を待たずに取り消す(tmp_path):
    camera = FakeCamera(block=True)
    control = app.StopControl()

    async def after(_info):
        await asyncio.to_thread(camera.blocked.wait, 5)
        control.request()

    async def main():
        loop = asyncio.get_running_loop()
        t0 = loop.time()
        try:
            config = make_config(tmp_path)
            _, result = await serve_until(
                config, deps(camera), control, after=after, stop_timeout_s=30
            )
        finally:
            camera.released.set()
        return result, loop.time() - t0

    result, took = run(main())
    assert result.reason == "forced" and took < 10
    assert control.forced


# RUN-4c
def test_RUN_4c_SIGINTの1回目で旗_SIGTERMの2回目ですぐ終わる(capsys):
    control = app.StopControl()
    exits = []

    async def main():
        loop = asyncio.get_running_loop()
        remove = app.install_signal_handlers(loop, control, hard_exit=exits.append)
        try:
            os.kill(os.getpid(), signal.SIGINT)
            await asyncio.sleep(0.1)
            first = (control.stopping, control.forced)
            os.kill(os.getpid(), signal.SIGTERM)
            await asyncio.sleep(0.1)
            second = (control.stopping, control.forced)
        finally:
            remove()
        return first, second

    assert run(main()) == ((True, False), (True, True))
    assert exits == [130]
    assert signal.getsignal(signal.SIGINT) is signal.default_int_handler
    err = capsys.readouterr().err
    assert "止めています" in err and "強制終了" in err


# RUN-4d・S-2
def test_RUN_4d_途中でカメラが読めなくなるとexit1で片付ける(tmp_path, logbuf):
    camera = FakeCamera(fail_after=5)

    async def main():
        return await app.serve(make_config(tmp_path), deps(camera), app.StopControl())

    result = run(main())
    assert result == app.RunResult(1, "error")
    assert camera.closed == 1
    assert named(logbuf, "run.failed")[0]["error_type"] == "SourceError"
    assert named(logbuf, "run.stopped")[0]["code"] == 1


def test_RUN_4d_mainは途中の失敗をexit1で知らせる(tmp_path, capsys):
    config = write_config(tmp_path)
    with RestoreLogging():
        code = app.main(
            ["--config", str(config), "--log-dir", str(tmp_path / "logs")],
            deps=deps(FakeCamera(fail_after=3)),
        )
    assert code == 1
    assert "途中で止まりました（error）" in capsys.readouterr().err


# RUN-4e・S-3
def test_RUN_4e_動画の入力が尽きるとeofでexit0(tmp_path):
    camera = FakeCamera(fps=200, limit=10)
    result = run(app.serve(make_config(tmp_path), deps(camera), app.StopControl()))
    assert result == app.RunResult(0, "eof")
    assert camera.closed == 1


def test_RUN_4a_StoppableSourceは閉じる失敗を飲み込み1回だけ閉じる(logbuf):
    class Bad:
        calls = 0

        def read(self):
            return None

        def close(self):
            Bad.calls += 1
            raise OSError("x")

    source = app.StoppableSource(Bad(), app.StopControl())
    source.close()
    source.close()
    assert Bad.calls == 1
    assert named(logbuf, "camera.close_failed")[0]["error_type"] == "OSError"


# ---- UC-5 --check ----


# RUN-5a
def test_RUN_5a_checkはカメラ1枚で2回推論しJSONを出して閉じる(tmp_path, capsys, logbuf):
    camera = FakeCamera()
    config = write_config(tmp_path)
    with RestoreLogging():
        code = app.main(["--config", str(config), "--check", "--no-l1"], deps=deps(camera))
    out = json.loads(capsys.readouterr().out)
    assert code == 0
    assert out["check"] == "ok" and out["model"] == "yolo26n-test.mlpackage"
    assert out["frame_shape"] == [48, 64, 3]
    assert out["first_infer_ms"] >= 0 and out["infer_ms"] >= 0
    assert out["detections"][0]["label"] == "deer"
    assert out["l1_enabled"] is False and out["capture_enabled"] is True
    assert camera.closed == 1 and camera.reads == 1
    assert not (tmp_path / "logs").exists()  # 走行ログを作らない


# RUN-5b
def test_RUN_5b_imageはカメラを開かずに画像で推論する(tmp_path, capsys):
    def no_camera(_c):
        raise AssertionError("カメラを開いた")

    d = app.Deps(
        load_detector=always_deer,
        open_source=no_camera,
        read_image=lambda _p: np.zeros((720, 1280, 3), dtype=np.uint8),
    )
    with RestoreLogging():
        code = app.main(
            ["--config", str(write_config(tmp_path)), "--check", "--image", "deer.jpg"], deps=d
        )
    assert code == 0
    assert json.loads(capsys.readouterr().out)["frame_shape"] == [720, 1280, 3]


# RUN-5b
def test_RUN_5b_読めない画像はexit2(tmp_path, capsys, monkeypatch):
    monkeypatch.setitem(
        __import__("sys").modules, "cv2", type("cv2", (), {"imread": staticmethod(lambda _p: None)})
    )
    d = app.Deps(load_detector=always_deer)
    with RestoreLogging():
        code = app.main(
            [
                "--config",
                str(write_config(tmp_path)),
                "--check",
                "--image",
                str(tmp_path / "x.jpg"),
            ],
            deps=d,
        )
    assert code == 2
    assert "画像を読めない: x.jpg" in capsys.readouterr().err


def test_RUN_5b_imageはcheckと一緒に使う(tmp_path, capsys):
    assert app.main(["--config", str(write_config(tmp_path)), "--image", "x.jpg"]) == 2
    assert "--check" in capsys.readouterr().err


def test_RUN_5a_カメラから読めないとexit2(tmp_path, capsys):
    with RestoreLogging():
        code = app.main(
            ["--config", str(write_config(tmp_path)), "--check"],
            deps=deps(FakeCamera(fail_after=0)),
        )
    assert code == 2 and "カメラから読めない" in capsys.readouterr().err
    with RestoreLogging():
        code = app.main(
            ["--config", str(write_config(tmp_path)), "--check"],
            deps=deps(FakeCamera(limit=0)),
        )
    assert code == 2 and "1 枚も読めない" in capsys.readouterr().err


class BrokenDetector:
    def detect(self, _image):
        raise RuntimeError("/Users/someone/secret")


# RUN-5a
def test_RUN_5a_checkの推論が失敗するとexit2で型名だけ出す(tmp_path, capsys):
    d = app.Deps(load_detector=lambda _c: BrokenDetector(), open_source=lambda _c: FakeCamera())
    with RestoreLogging():
        code = app.main(["--config", str(write_config(tmp_path)), "--check"], deps=d)
    err = capsys.readouterr().err
    assert code == 2 and "推論できない（RuntimeError）" in err
    assert "/Users/someone" not in err


# RUN-1b
def test_RUN_1b_log_levelはDEBUGとINFOだけ_WARNINGではt_frameが落ちる(tmp_path, capsys):
    with pytest.raises(SystemExit) as exc:
        app.main(["--config", str(write_config(tmp_path)), "--log-level", "WARNING"])
    assert exc.value.code == 2


def test_RUN_5b_opencvが無いとSourceError(monkeypatch, tmp_path):
    monkeypatch.setitem(__import__("sys").modules, "cv2", None)
    with pytest.raises(SourceError, match="opencv"):
        app.read_image(tmp_path / "x.jpg")


# RUN-5a
def test_RUN_5a_checkはポートが使用中ならexit2でモデルを読まない(tmp_path, capsys):
    loaded = []
    with busy_port() as s:
        text = CONFIG_TEXT + f"\n[server]\nport = {s.getsockname()[1]}\n"
        d = app.Deps(load_detector=lambda c: loaded.append(c), open_source=lambda c: FakeCamera())
        with RestoreLogging():
            code = app.main(["--config", str(write_config(tmp_path, text)), "--check"], deps=d)
    assert code == 2 and "WebSocket の待ち受けを始められない" in capsys.readouterr().err
    assert loaded == []


# RUN-5a
def test_RUN_5a_checkはdeer_detectedを出しcaptureの置き場所を作らない(tmp_path, capsys):
    class Faint:
        def detect(self, image):
            from detector.inference import Detection

            return [Detection("deer", 0.5, (0.5, 0.5, 0.1, 0.1))]

    d = app.Deps(load_detector=lambda c: Faint(), open_source=lambda c: FakeCamera())
    with RestoreLogging():
        assert app.main(["--config", str(write_config(tmp_path)), "--check"], deps=d) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["detections"] and out["deer_detected"] is False  # 0.5 は赤の閾値 0.8 未満
    assert not (tmp_path / "captures").exists() and not (tmp_path / "logs").exists()


# RUN-1c
def test_RUN_1c_走行ログはスタックを書かず型名だけ_websocketsはDEBUGでもINFOまで(tmp_path):
    with RestoreLogging():
        path = app.setup_logging(tmp_path / "logs", "DEBUG", console=io.StringIO())
        log = logging.getLogger("detector.test")
        try:
            raise OSError("/Users/someone/secret/path")
        except OSError:
            log.exception("boom")
        logging.getLogger("websockets.server").debug('< TEXT \'{"type":"ack"}\'')
        logging.getLogger("detector.websockets").debug("< TEXT body")
    text = path.read_text()
    entry = json.loads(text.splitlines()[0])
    assert entry["event"] == "boom" and entry["error_type"] == "OSError"
    assert "error" not in entry and "/Users/" not in text
    assert "TEXT" not in text


# RUN-2c
def test_RUN_2c_読み込みの間に止められたら待ち受けずに終わる(tmp_path, logbuf):
    control = app.StopControl()
    camera = FakeCamera()

    def slow_load(_c):
        control.request()  # CoreML のコンパイル中の Ctrl-C
        return always_deer(_c)

    d = app.Deps(load_detector=slow_load, open_source=lambda c: camera)
    assert run(app.serve(make_config(tmp_path), d, control)) == app.RunResult(0, "signal")
    assert named(logbuf, "server.listening") == [] and camera.closed == 1


def test_RUN_2c_想定外の例外はexit1で走行ログには型名だけ(tmp_path, capsys, monkeypatch):
    async def crash(*_a):
        raise TypeError("/Users/x/oops")

    monkeypatch.setattr(app, "_run", crash)
    monkeypatch.setattr(app, "install_excepthook", lambda: None)
    with RestoreLogging():
        code = app.main(["--config", str(write_config(tmp_path)), "--log-dir", str(tmp_path / "l")])
    assert code == 1
    assert "TypeError" in capsys.readouterr().err  # スタックは端末にだけ
    text = next((tmp_path / "l").glob("run-*.jsonl")).read_text()
    stopped = json.loads(text.splitlines()[-1])
    assert stopped["reason"] == "crashed" and stopped["error_type"] == "TypeError"
    assert "/Users/x" not in text


def test_RUN_2c_シグナルの受け口の前のCtrl_Cは130(tmp_path, monkeypatch):
    async def interrupted(*_a):
        raise KeyboardInterrupt

    monkeypatch.setattr(app, "_run", interrupted)
    monkeypatch.setattr(app, "install_excepthook", lambda: None)
    with RestoreLogging():
        code = app.main(["--config", str(write_config(tmp_path)), "--log-dir", str(tmp_path / "l")])
    assert code == 130
