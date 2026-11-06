"""edge-run の受け入れ: 入口全体を偽のカメラ・偽の L0 で通す（実機・CoreML・opencv は使わない）。"""

from __future__ import annotations

import asyncio
import json
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

from websockets.asyncio.client import connect

from detector import app

from .app_fakes import FakeCamera, RestoreLogging, always_deer, make_config
from .test_runner import VALIDATOR

SRC = Path(__file__).resolve().parents[1] / "src"


def refused(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(1)
        return s.connect_ex(("127.0.0.1", port)) != 0


def lines(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


# RUN-AC-1・RUN-1c・RUN-3b・RUN-4a
def test_RUN_AC_1_偽のカメラで赤を配信し止める旗で片付けて走行ログを残す(tmp_path):
    config = make_config(tmp_path)
    camera = FakeCamera()
    deps = app.Deps(load_detector=always_deer, open_source=lambda _c: camera)
    control = app.StopControl()

    async def main():
        loop = asyncio.get_running_loop()
        ready: asyncio.Future[app.RunInfo] = loop.create_future()
        task = asyncio.create_task(app.serve(config, deps, control, ready=ready.set_result))
        info = await asyncio.wait_for(ready, 5)
        seen = []
        async with connect(f"ws://127.0.0.1:{info.ws_port}/alerts") as ws:
            while True:
                flag = json.loads(await asyncio.wait_for(ws.recv(), 5))
                seen.append(flag)
                if flag["deer"]:
                    break
            # capture の HTTP も待ち受けている（RUN-3b）
            reader, writer = await asyncio.open_connection("127.0.0.1", info.capture_port)
            writer.write(b"GET /captures HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
            await writer.drain()
            status = (await reader.readline()).decode()
            writer.close()
            control.request()
        result = await asyncio.wait_for(task, 10)
        return info, seen, status, result

    with RestoreLogging():
        log_path = app.setup_logging(tmp_path / "logs", "INFO")
        info, seen, status, result = asyncio.run(asyncio.wait_for(main(), 30))
    assert result == app.RunResult(0, "signal")
    on = seen[-1]
    assert on["deer"] is True and on["side"] == "L" and VALIDATOR.is_valid(on)
    assert " 200 " in status
    assert info.l1 is False
    assert camera.closed == 1  # どの終わり方でも 1 回
    assert refused(info.ws_port) and refused(info.capture_port)
    events = lines(log_path)
    names = [e["event"] for e in events]
    started = next(e for e in events if e["event"] == "run.started")
    assert started["model"] == "yolo26n-test.mlpackage"
    assert started["ws_port"] == info.ws_port and started["capture_port"] == info.capture_port
    assert started["l1_enabled"] is False and started["capture_enabled"] is True
    # RUN-1c: 絶対パス・スタックを出さない（走行ログ全体）
    whole = log_path.read_text(encoding="utf-8")
    assert str(tmp_path) not in whole and "/Users/" not in whole
    assert all("stack" not in e and "error" not in e for e in events)
    sent = [e for e in events if e["event"] == "flag.sent" and e["deer"]]
    assert sent and all(e["t_frame"] and e["t_sent"] for e in sent)
    stopped = next(e for e in events if e["event"] == "run.stopped")
    assert (stopped["reason"], stopped["code"]) == ("signal", 0)
    # 片付けの順: pipeline が終わってから止まった記録
    assert names.index("pipeline.summary") < names.index("run.stopped")


STUCK = """
import sys, threading
from datetime import UTC, datetime
from dataclasses import replace
import numpy as np
from detector import app
from detector.frame import Frame
from detector.inference import DeerDetector, Detection

class Stuck:  # 3 枚のあと read() が戻らないカメラ
    n = 0
    def read(self):
        if Stuck.n >= 3:
            threading.Event().wait()
        Stuck.n += 1
        return Frame(np.zeros((48, 64, 3), dtype=np.uint8), datetime.now(UTC), Stuck.n)
    def close(self):
        sys.stderr.write("CLOSED\\n")

class Deer:
    def detect(self, image):
        return [Detection("deer", 0.9, (0.3, 0.5, 0.1, 0.12))]

deps =app.Deps(load_detector=lambda c: DeerDetector(Deer()), open_source=lambda c: Stuck())
real_serve = app.serve
async def serve(config, d, control, **kw):
    s = replace(config.server, port=0)
    c = replace(config.capture_server, port=0)
    config = replace(config, server=s, capture_server=c)
    return await real_serve(config, d, control, stop_timeout_s=1.0, **kw)
app.serve = serve
raise SystemExit(app.main(sys.argv[1:], deps=deps))
"""


def start_stuck(tmp_path: Path) -> subprocess.Popen:
    config = tmp_path / "config.toml"
    config.write_text('[infer]\nmodel_path = "m.mlpackage"\n[l1]\nenabled = false\n')
    script = tmp_path / "stuck.py"
    script.write_text(STUCK, encoding="utf-8")
    env = {**os.environ, "PYTHONPATH": str(SRC), "PYTHONIOENCODING": "utf-8"}
    proc = subprocess.Popen(  # noqa: S603  自分の Python で自分のモジュールを起動する
        [sys.executable, str(script), "--config", str(config)],
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    )
    assert proc.stderr is not None
    for line in proc.stderr:  # 待ち受けが始まるまで
        if "待ち受けています" in line:
            return proc
    proc.kill()
    raise AssertionError("起動しなかった")


# RUN-4b・S-4
def test_RUN_4b_readが戻らなくてもCtrl_Cから上限の秒数でプロセスが終わる(tmp_path):
    proc = start_stuck(tmp_path)
    time.sleep(0.5)
    proc.send_signal(signal.SIGINT)
    try:
        code = proc.wait(timeout=15)
    finally:
        proc.kill()
    rest = proc.stderr.read() if proc.stderr else ""
    assert code == 0, rest
    assert "CLOSED" not in rest  # read() の中にいるカメラを解放しない
    log = next((tmp_path / "logs").glob("run-*.jsonl"))
    stopped = [json.loads(x) for x in log.read_text().splitlines() if '"run.stopped"' in x]
    assert stopped[-1]["reason"] == "forced"


# RUN-4c
def test_RUN_4c_2回目のCtrl_Cはすぐexit130(tmp_path):
    proc = start_stuck(tmp_path)
    time.sleep(0.5)
    proc.send_signal(signal.SIGINT)
    time.sleep(0.2)
    proc.send_signal(signal.SIGINT)
    try:
        code = proc.wait(timeout=5)
    finally:
        proc.kill()
    assert code == 130


# RUN-AC-2
def test_RUN_AC_2_python_m_detectorはモデルが無いとexit2で手順書を指す(tmp_path):
    config = tmp_path / "car" / "config.toml"
    config.parent.mkdir()
    config.write_text('[infer]\nmodel_path = "models/nothing.mlpackage"\n', encoding="utf-8")
    env = {**os.environ, "PYTHONPATH": str(SRC), "PYTHONIOENCODING": "utf-8"}
    proc = subprocess.run(  # noqa: S603  自分の Python で自分のモジュールを起動する
        [sys.executable, "-m", "detector", "--config", str(config)],
        capture_output=True,
        text=True,
        env=env,
        timeout=60,
        check=False,
    )
    assert proc.returncode == 2, proc.stderr
    assert "nothing.mlpackage" in proc.stderr
    assert app.RUNBOOK in proc.stderr
    assert str(config.parent / "models") not in proc.stderr  # 親ディレクトリを出さない
    help_ = subprocess.run(
        [sys.executable, "-m", "detector", "--help"],
        capture_output=True,
        text=True,
        env=env,
        timeout=60,
        check=False,
    )
    assert help_.returncode == 0 and "--no-l1" in help_.stdout
