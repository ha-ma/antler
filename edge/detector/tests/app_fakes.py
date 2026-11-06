"""edge-run のテストの部品: 偽のカメラ・偽の L0・ポート 0 の設定。

実機・CoreML・opencv は使わない。
"""

from __future__ import annotations

import logging
import socket
import threading
import time
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from detector.config import Config, load_config
from detector.frame import Frame
from detector.inference import DeerDetector, Detection
from detector.ports import SourceError

CONFIG_TEXT = """
[infer]
model_path = "models/yolo26n-test.mlpackage"

[l1]
enabled = false

[capture]
dir = "captures"
"""


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def write_config(tmp_path: Path, text: str = CONFIG_TEXT) -> Path:
    """main() を通すテスト用。8765・8767 は手元の偽 edge が使うことがあるので空きを書く。"""
    for section in ("server", "capture_server"):
        if f"[{section}]" not in text:
            text += f"\n[{section}]\nport = {free_port()}\n"
    path = tmp_path / "config.toml"
    path.write_text(text, encoding="utf-8")
    return path


def port0(config: Config) -> Config:
    """8765・8767 を使わない（load_config は 0 を受けないので後から差し替える）。"""
    return replace(
        config,
        server=replace(config.server, port=0),
        capture_server=replace(config.capture_server, port=0),
    )


def make_config(tmp_path: Path, text: str = CONFIG_TEXT) -> Config:
    return port0(load_config(write_config(tmp_path, text)))


class FakeCamera:
    """実時間でフレームを出し続けるカメラ。fail_after 枚で SourceError、limit 枚で終わり。

    block を立てると、止める旗のあとの read() が戻らないカメラになる（release で戻る）。
    """

    def __init__(
        self,
        fps: float = 60.0,
        fail_after: int | None = None,
        limit: int | None = None,
        block: bool = False,
    ) -> None:
        self.interval = 1.0 / fps
        self.fail_after = fail_after
        self.limit = limit
        self.block = block
        self.released = threading.Event()
        self.blocked = threading.Event()
        self.reads = 0
        self.closed = 0

    def read(self) -> Frame | None:
        if self.block and self.reads >= 3:
            self.blocked.set()
            self.released.wait(30)
        time.sleep(self.interval)
        if self.fail_after is not None and self.reads >= self.fail_after:
            raise SourceError("camera: フレームを読めない")
        if self.limit is not None and self.reads >= self.limit:
            return None
        seq = self.reads
        self.reads += 1
        return Frame(np.zeros((48, 64, 3), dtype=np.uint8), datetime.now(UTC), seq)

    def close(self) -> None:
        self.closed += 1


class AlwaysDeer:
    """いつも左寄りの鹿が 1 頭写っている L0。"""

    def __init__(self) -> None:
        self.calls = 0

    def detect(self, image: np.ndarray) -> list[Detection]:
        self.calls += 1
        return [Detection("deer", 0.92, (0.3, 0.5, 0.1, 0.12))]


def always_deer(_config: Config) -> DeerDetector:
    return DeerDetector(AlwaysDeer())


class RestoreLogging:
    """setup_logging がルートの handler を替えるので、テストのあとに戻す。"""

    def __enter__(self) -> RestoreLogging:
        root = logging.getLogger()
        self.handlers = root.handlers[:]
        self.level = root.level
        return self

    def __exit__(self, *exc: object) -> None:
        root = logging.getLogger()
        for h in root.handlers:
            if h not in self.handlers:
                h.close()
        root.handlers[:] = self.handlers
        root.setLevel(self.level)
