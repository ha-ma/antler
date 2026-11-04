"""何を保存するか（B2-5。docs/specs/edge-capture E2・E3）。赤の経路を待たせない。

`offer(result)` は判定してよいときだけ画像を縮めて（コピーを持つ）ワーカーに渡して即戻る。
JPEG への変換とディスクへの書き込みは専用のスレッドで行う。ワーカーの待ち行列は queue_size までで、
溢れたら捨てて数える（capture.dropped）。L1 の答え（on_l1_answer）もディスクに触れず、ワーカーに
任せる。どのスレッドから呼んでもよい（状態は 1 本のロックで守る）。
"""

from __future__ import annotations

import logging
import math
import threading
from collections import deque
from dataclasses import dataclass
from time import monotonic, perf_counter
from typing import TYPE_CHECKING

from detector.capture.jpeg import shrink
from detector.capture.model import (
    UNKNOWN_SEGMENT,
    build_capture,
    new_capture_id,
    valid_l1_probs,
)
from detector.frame import format_t_frame
from detector.judge import is_blind

if TYPE_CHECKING:
    from collections.abc import Callable
    from datetime import datetime

    import numpy as np

    from detector.capture.jpeg import JpegEncoder
    from detector.capture.store import CaptureStore
    from detector.config import CaptureConfig
    from detector.pipeline import FrameResult
    from detector.ports import Detection

__all__ = ["CaptureRecorder"]

logger = logging.getLogger("detector.capture")

DEGRADED_AFTER = 20
RECENT_KEEP = 64
CLOSE_TIMEOUT_S = 2.0


@dataclass
class _Pending:
    """offer した 1 枚の記録。保存の前後をまたいで l1Probs を一度だけ付けるために持つ。"""

    capture_id: str
    offered_at: float
    probs: dict[str, object] | None = None
    saved: bool = False


@dataclass(frozen=True)
class _Save:
    pending: _Pending
    detections: list[Detection]
    t_frame: datetime
    image: np.ndarray


@dataclass(frozen=True)
class _Attach:
    capture_id: str
    probs: dict[str, object]


class CaptureRecorder:
    def __init__(
        self,
        config: CaptureConfig,
        store: CaptureStore,
        encoder: JpegEncoder,
        *,
        distance_table: tuple[tuple[float, float], ...],
        min_box_conf: float,
        segment: Callable[[], object] | None = None,
        new_id: Callable[[], str] = new_capture_id,
        clock: Callable[[], float] = monotonic,
    ) -> None:
        self._cfg = config
        self._store = store
        self._encoder = encoder
        self._table = distance_table
        self._min_box_conf = min_box_conf
        self._segment = segment
        self._new_id = new_id
        self._clock = clock
        self._cond = threading.Condition()
        self._jobs: deque[_Save | _Attach] = deque()
        self._busy = False
        self._closing = False
        self._last_frame_at: float | None = None
        self._last_saved_t: datetime | None = None
        self._offered = 0
        self._limit_logged = False
        self._recent: deque[_Pending] = deque(maxlen=RECENT_KEEP)
        self._last_answer: tuple[dict[str, object], float] | None = None
        self.dropped = 0
        self._failures = 0
        self._degraded = False
        self._worker = threading.Thread(target=self._run, name="capture-writer", daemon=True)
        self._worker.start()

    # --- 検知のスレッドから ---

    def idle_seconds(self) -> float | None:
        """最後にフレームを受け取ってからの秒（走行中かの判定。まだ 1 枚も無ければ None）。"""
        with self._cond:
            if self._last_frame_at is None:
                return None
            return max(0.0, self._clock() - self._last_frame_at)

    def offer(self, result: FrameResult) -> bool:
        """保存の対象ならキューに入れて True。待たない。例外を外へ出さない。"""
        try:
            return self._offer(result)
        except Exception as exc:  # noqa: BLE001  保存の失敗で検知を止めない
            logger.error("capture.failed", extra={"error_type": type(exc).__name__})
            return False

    def _offer(self, result: FrameResult) -> bool:
        now = self._clock()
        with self._cond:
            self._last_frame_at = now
            if self._closing:
                return False
        if is_blind(result) or result.image is None or not _has_trigger(result, self._cfg):
            return False
        t_frame = result.t_frame
        with self._cond:
            if self._offered >= self._cfg.max_per_run:
                if not self._limit_logged:
                    self._limit_logged = True
                    logger.info("capture.run_limit", extra={"max_per_run": self._cfg.max_per_run})
                return False
            last = self._last_saved_t
            if last is not None:
                elapsed = (t_frame - last).total_seconds()
                if 0.0 <= elapsed < self._cfg.min_interval_s:
                    return False
            # 間隔の基準は、キューに入れようとした時点で置く（満杯で捨てても毎フレーム縮めない）。
            # elapsed < 0（時計の巻き戻し）はここを通って基準を置き直す
            self._last_saved_t = t_frame
        # コピーを持つ（元の画像は次の推論でも使われる）
        small = shrink(result.image, self._cfg.image_width)
        pending = _Pending(self._new_id(), now)
        with self._cond:
            if self._closing:
                return False
            queued = sum(1 for job in self._jobs if isinstance(job, _Save))
            if queued >= self._cfg.queue_size:
                self.dropped += 1
                logger.warning("capture.dropped", extra={"dropped": self.dropped})
                return False
            if self._last_answer is not None:
                probs, at = self._last_answer
                if abs(at - now) <= self._cfg.l1_attach_window_s:
                    pending.probs = probs
            self._recent.append(pending)
            self._offered += 1
            self._jobs.append(_Save(pending, list(result.detections), t_frame, small))
            self._cond.notify()
        return True

    # --- L1 のイベントループから（ディスクに触れない） ---

    def on_l1_answer(self, answer: object, at: float, fresh: bool = True) -> None:
        """L1 の答え（校正前の生の確率）を、前後 l1_attach_window_s 秒の保存に付ける。

        確率を検査して記録し、保存済みのものはワーカーに書き足しを頼むだけ（待たない）。
        """
        if not fresh:
            return
        try:
            probs = valid_l1_probs(_probs_of(answer))
        except Exception:  # noqa: BLE001  観察者は L1 の動作を変えない
            return
        if probs is None or not math.isfinite(at):
            return
        with self._cond:
            if self._closing:
                return
            self._last_answer = (probs, at)
            window = self._cfg.l1_attach_window_s
            for pending in self._recent:
                if pending.probs is None and abs(pending.offered_at - at) <= window:
                    pending.probs = probs
                    if pending.saved:
                        self._jobs.append(_Attach(pending.capture_id, probs))
            self._cond.notify()

    # --- 終了・待ち合わせ ---

    def flush(self, timeout: float = CLOSE_TIMEOUT_S) -> bool:
        """待ち行列が空になって、ワーカーが手を止めるまで待つ。間に合えば True。"""
        with self._cond:
            return self._cond.wait_for(lambda: not self._jobs and not self._busy, timeout)

    def close(self, timeout: float = CLOSE_TIMEOUT_S) -> None:
        """待ち行列を最大 timeout 秒で吐き出して止める。2 回呼んでもよい。"""
        with self._cond:
            self._closing = True
            self._cond.notify_all()
        self._worker.join(timeout)
        if self._worker.is_alive():
            logger.warning("capture.close_timeout")

    # --- ワーカー ---

    def _run(self) -> None:
        while True:
            with self._cond:
                self._cond.wait_for(lambda: bool(self._jobs) or self._closing)
                if not self._jobs:
                    return
                job = self._jobs.popleft()
                self._busy = True
            try:
                if isinstance(job, _Save):
                    self._save(job)
                else:
                    self._attach(job)
            except Exception as exc:  # noqa: BLE001  1 枚の失敗でワーカーを止めない
                self._failed(exc)
            finally:
                with self._cond:
                    self._busy = False
                    self._cond.notify_all()

    def _save(self, job: _Save) -> None:
        pending = job.pending
        started = perf_counter()
        data = self._encoder.encode(job.image, self._cfg.jpeg_quality)
        encoded = perf_counter()
        if self._store.has(pending.capture_id):
            with self._cond:  # 乱数の衝突（まれ）。作り直す
                pending.capture_id = self._new_id()
        with self._cond:
            probs = pending.probs
        capture = build_capture(
            capture_id=pending.capture_id,
            detections=job.detections,
            t_frame=job.t_frame,
            image_size=(job.image.shape[1], job.image.shape[0]),
            distance_table=self._table,
            min_box_conf=self._min_box_conf,
            segment=self._segment_now(),
            l1_probs=probs,
        )
        self._store.save(capture, data)
        written = perf_counter()
        with self._cond:
            pending.saved = True
            late = pending.probs if probs is None else None
        if late is not None:  # 保存のあいだに答えが来ていた
            self._attach(_Attach(pending.capture_id, late))
        self._succeeded()
        logger.info(
            "capture.saved",
            extra={
                "id": pending.capture_id,
                "t_frame": format_t_frame(job.t_frame),
                "encode_ms": round((encoded - started) * 1000.0, 2),
                "write_ms": round((written - encoded) * 1000.0, 2),
                "bytes": len(data),
            },
        )

    def _attach(self, job: _Attach) -> None:
        self._store.attach_l1_probs(job.capture_id, job.probs)

    def _segment_now(self) -> object:
        if self._segment is None:
            return UNKNOWN_SEGMENT
        try:
            return self._segment()
        except Exception:  # noqa: BLE001  位置の提供元が壊れても保存する（unknown にする）
            return UNKNOWN_SEGMENT

    def _failed(self, exc: Exception) -> None:
        self._failures += 1
        logger.error("capture.failed", extra={"error_type": type(exc).__name__})
        if self._failures == DEGRADED_AFTER:
            self._degraded = True
            logger.critical("capture.degraded", extra={"failures": self._failures})

    def _succeeded(self) -> None:
        if self._degraded:
            self._degraded = False
            logger.info("capture.recovered")
        self._failures = 0


def _has_trigger(result: FrameResult, config: CaptureConfig) -> bool:
    return any(
        d.conf >= config.trigger_conf
        and math.isfinite(d.xywh[3])
        and d.xywh[3] > 0.0
        and math.isfinite(d.conf)
        for d in result.detections
    )


def _probs_of(answer: object) -> dict[str, object]:
    """L1Answer（校正前）を Capture.l1Probs の形にする。属性が無ければ AttributeError。"""
    levels = answer.alert_level  # type: ignore[attr-defined]
    return {
        "alert_level": dict(levels),
        "on_roadway": answer.on_roadway,  # type: ignore[attr-defined]
        "static_shoulder": answer.static_shoulder,  # type: ignore[attr-defined]
        "false_positive": answer.false_positive,  # type: ignore[attr-defined]
    }
