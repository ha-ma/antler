"""つなぎ（docs/specs/edge-capture E6）: store・recorder・HTTP を組み立て、検知の結果に重ねる。

使い方（起動の入口で）:

    service = CaptureService.from_config(config)          # enabled = false なら None
    results = service.wrap(process_frames(...))           # 結果は先に下流（hub）へ渡る
    l1 = start_l1(config, hub, observer=service.on_l1_answer)
    service.start()                                       # PWA 向けの HTTP（別ポート）
    ...
    service.close()
"""

from __future__ import annotations

import contextlib
import logging
from typing import TYPE_CHECKING

from detector.capture.http import CaptureApi, CaptureServer
from detector.capture.jpeg import JpegEncoder, OpenCvJpegEncoder
from detector.capture.recorder import CaptureRecorder
from detector.capture.store import CaptureStore
from detector.config import resolve_path

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator

    from detector.config import Config
    from detector.l1.client import L1Answer
    from detector.pipeline import FrameResult

__all__ = ["CaptureService"]

logger = logging.getLogger("detector.capture")


class CaptureService:
    def __init__(
        self,
        store: CaptureStore,
        recorder: CaptureRecorder,
        api: CaptureApi,
        server: CaptureServer,
    ) -> None:
        self.store = store
        self.recorder = recorder
        self.api = api
        self.server = server

    @classmethod
    def from_config(
        cls,
        config: Config,
        *,
        encoder: JpegEncoder | None = None,
        segment: Callable[[], object] | None = None,
    ) -> CaptureService | None:
        """capture.enabled = false なら None（何も作らない）。位置の区間の提供元は任意。"""
        cfg = config.capture
        if not cfg.enabled:
            logger.info("capture.disabled")
            return None
        store = CaptureStore(
            resolve_path(config, cfg.dir),
            max_items=cfg.max_items,
            retention_hours=cfg.retention_hours,
        )
        recorder = CaptureRecorder(
            cfg,
            store,
            encoder or OpenCvJpegEncoder(),
            distance_table=config.judge.distance_table,
            min_box_conf=config.tracker.min_conf,
            segment=segment,
        )
        api = CaptureApi(store, recorder.idle_seconds, config.capture_server.allowed_origins)
        return cls(store, recorder, api, CaptureServer(api, config.capture_server))

    def wrap(self, results: Iterator[FrameResult]) -> Iterator[FrameResult]:
        """結果を先に下流へ渡してから offer する（赤の判定のあとに保存を考える）。

        offer は次のフレームを要求されたときに走るので、入力が尽きる・閉じられる直前の最後の 1 枚は
        offer されないことがある。入力の生成器は閉じる。
        """
        try:
            for result in results:
                yield result
                self._offer(result)
        finally:
            close = getattr(results, "close", None)
            if close is not None:
                with contextlib.suppress(ValueError, RuntimeError):
                    close()

    def _offer(self, result: FrameResult) -> None:
        try:
            self.recorder.offer(result)
        except Exception as exc:  # noqa: BLE001  保存の失敗で検知を止めない
            logger.error("capture.failed", extra={"error_type": type(exc).__name__})

    def on_l1_answer(self, answer: L1Answer, at: float, fresh: bool) -> None:
        """start_l1(observer=...) に渡す。ディスクに触れない。"""
        self.recorder.on_l1_answer(answer, at, fresh)

    def start(self) -> int:
        """PWA 向けの HTTP を始めて、実際のポートを返す。"""
        return self.server.start()

    def close(self) -> None:
        self.server.stop()
        self.recorder.close()
