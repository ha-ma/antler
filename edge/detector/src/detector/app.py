"""起動の入口（docs/specs/edge-run）。

設定 → モデル → カメラ → 判定 → WebSocket・capture・L1 を組み立てる。

    python -m detector --config edge/detector/config.toml [--no-l1] [--no-capture] [--check]

組み立て順は edge-capture の `CaptureService` の docstring のまま。判定・配信・保存の挙動は変えない
（赤は L0 だけで決まる）。この入口が足すのは、起動前の検査・停止の順序・走行ログのファイルだけ。

終了コード: 0 = 止めた / 入力が尽きた / `--check` が通った、1 = 動いている途中で止まった、
2 = 起動できない、130 = 2 回目の Ctrl-C。
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import importlib
import json
import logging
import os
import signal
import socket
import sys
import threading
import traceback
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter
from typing import TYPE_CHECKING, TextIO

from detector.capture.http import CaptureServerError
from detector.capture.service import CaptureService
from detector.config import Config, ConfigError, load_config, resolve_path
from detector.frame import Frame, resize_frame
from detector.hub import AlertHub
from detector.l0.coreml import load_coreml_detector
from detector.l1.runner import start_l1
from detector.log import JsonFormatter, install_excepthook
from detector.pipeline import process_frames
from detector.ports import SourceError
from detector.runner import pump
from detector.server import AlertServer, ServerError
from detector.sources import open_camera, open_video_file

if TYPE_CHECKING:
    from collections.abc import Callable, Coroutine, Mapping

    import numpy as np

    from detector.ports import Detector, FrameSource

__all__ = [
    "EXIT_OK",
    "EXIT_RUNTIME",
    "EXIT_STARTUP",
    "RUNBOOK",
    "Deps",
    "RunInfo",
    "RunResult",
    "StartupError",
    "StopControl",
    "StoppableSource",
    "apply_overrides",
    "check",
    "install_signal_handlers",
    "load_detector",
    "main",
    "open_source",
    "read_image",
    "serve",
    "setup_logging",
]

logger = logging.getLogger("detector.app")

EXIT_OK, EXIT_RUNTIME, EXIT_STARTUP = 0, 1, 2
EXIT_KILLED = 130  # 2 回目の Ctrl-C・起動の直後の Ctrl-C（シェルの慣習 128 + SIGINT）
RUNBOOK = "docs/runbooks/2026-11-06-mac-mini-edge-run.md"
STOP_TIMEOUT_S = 5.0  # 止める旗から片付けまでの上限。超えたら pump を取り消す（read() が戻らない）
POLL_S = 0.05
LEVELS = ("DEBUG", "INFO", "WARNING")


class StartupError(Exception):
    """起動できない（設定・モデル・カメラ・ポート）。メッセージを stderr に出して exit 2。"""


class StopControl:
    """止める旗。1 回目で入力を止め、2 回目で取り消す。シグナルのハンドラとテストから呼ぶ。"""

    def __init__(self) -> None:
        self._stop = threading.Event()
        self._force = threading.Event()

    @property
    def stopping(self) -> bool:
        return self._stop.is_set()

    @property
    def forced(self) -> bool:
        return self._force.is_set()

    def request(self, reason: str = "signal") -> str:
        """1 回目は "stop"、2 回目からは "force" を返す。"""
        if not self._stop.is_set():
            self._stop.set()
            logger.info("run.stopping", extra={"reason": reason})
            return "stop"
        if not self._force.is_set():
            self._force.set()
            logger.warning("run.forcing", extra={"reason": reason})
        return "force"


class StoppableSource:
    """入力を包み、止める旗が立ったら「終わり」（None）を返す。close は 1 回だけ。"""

    def __init__(self, inner: FrameSource, control: StopControl) -> None:
        self._inner = inner
        self._control = control
        self._closed = False
        self._lock = threading.Lock()

    def read(self) -> Frame | None:
        if self._control.stopping:
            return None
        return self._inner.read()

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
        close = getattr(self._inner, "close", None)
        if close is not None:
            try:
                close()
            except Exception as exc:  # noqa: BLE001  解放の失敗で片付けを止めない
                logger.warning("camera.close_failed", extra={"error_type": type(exc).__name__})


@dataclass(frozen=True)
class RunInfo:
    """待ち受けが始まったときに ready に渡す（テストは実際のポートを知る）。"""

    ws_port: int
    capture_port: int | None
    l1: bool


@dataclass(frozen=True)
class RunResult:
    code: int
    reason: str  # signal | eof | error | forced


def load_detector(config: Config) -> Detector:
    """`infer.model_path` を設定ファイルのディレクトリから解決し、無ければ手順書を指して止める。"""
    raw = config.infer.model_path
    if not raw:
        msg = f"infer.model_path が空（CoreML のモデルのパスを書く。手順書 {RUNBOOK} の 4.）"
        raise ConfigError(msg)
    path = resolve_path(config, raw)
    if not path.exists():
        # 親ディレクトリは出さない（ファイル名だけ）
        msg = f"モデルが無い: {path.name}（手順書 {RUNBOOK} の 3. で edge/detector/models/ に置く）"
        raise ConfigError(msg)
    return load_coreml_detector(replace(config, infer=replace(config.infer, model_path=str(path))))


def open_source(config: Config) -> FrameSource:
    cam = config.camera
    if cam.source == "file":
        return open_video_file(str(resolve_path(config, cam.path)))
    return open_camera(cam.device, cam.width, cam.height, cam.fps)


def read_image(path: Path) -> np.ndarray:
    """`--check --image` の画像（BGR）。opencv で読む。"""
    try:
        cv2 = importlib.import_module("cv2")
    except ImportError as exc:
        msg = "opencv が入っていない（pip install -e 'edge/detector[run]'）"
        raise SourceError(msg) from exc
    image = cv2.imread(str(path))
    if image is None:
        msg = f"画像を読めない: {path.name}"
        raise SourceError(msg)
    return image


@dataclass(frozen=True)
class Deps:
    """差し替え口。実機は既定のまま。テストは偽のカメラ・偽の L0 を入れる。"""

    load_detector: Callable[[Config], Detector] = load_detector
    open_source: Callable[[Config], FrameSource] = open_source
    read_image: Callable[[Path], np.ndarray] = read_image
    capture: Callable[[Config], CaptureService | None] = CaptureService.from_config
    start_l1: Callable[..., Coroutine[object, object, None] | None] = start_l1
    environ: Mapping[str, str] | None = None


def apply_overrides(config: Config, *, no_l1: bool = False, no_capture: bool = False) -> Config:
    if no_l1:
        config = replace(config, l1=replace(config.l1, enabled=False))
    if no_capture:
        config = replace(config, capture=replace(config.capture, enabled=False))
    return config


def _detector(config: Config, deps: Deps) -> Detector:
    try:
        return deps.load_detector(config)
    except ConfigError as exc:
        raise StartupError(str(exc)) from exc
    except (OSError, RuntimeError, ValueError) as exc:  # coremltools が壊れたモデルで出すもの
        name = Path(config.infer.model_path).name
        msg = f"モデルを読めない: {name}（{type(exc).__name__}）"
        raise StartupError(msg) from exc


def _source(config: Config, deps: Deps) -> FrameSource:
    try:
        return deps.open_source(config)
    except SourceError as exc:
        raise StartupError(f"カメラを開けない: {exc}") from exc


def _close_quietly(source: FrameSource) -> None:
    close = getattr(source, "close", None)
    if close is not None:
        with contextlib.suppress(Exception):
            close()


# ---- 走行ログ ----


class _NoStack(logging.Filter):
    """例外のスタック・文言（絶対パスや受信の本文が入りうる）を落とし、型名だけ残す（R5）。"""

    def filter(self, record: logging.LogRecord) -> bool:
        if record.exc_info:
            error = record.exc_info[1]
            if error is not None and not hasattr(record, "error_type"):
                record.error_type = type(error).__name__
            record.exc_info = None
            record.exc_text = None
        record.stack_info = None
        return True


# websockets は DEBUG で受信したフレームの中身を出す。--log-level DEBUG でも INFO より下は書かない
_QUIET = ("websockets", "detector.websockets")


def setup_logging(
    log_dir: Path | None,
    level: str = "INFO",
    *,
    console: TextIO | None = None,
    now: Callable[[], datetime] = datetime.now,
) -> Path | None:
    """ファイル（`log_dir/run-YYYYMMDD-HHMMSS.jsonl`、level 以上）と端末（stderr、WARNING 以上）。

    log_dir が None なら端末だけ。同じ秒に 2 回起動しても上書きしない。スタックは書かない。
    """
    formatter = JsonFormatter()
    no_stack = _NoStack()
    term = logging.StreamHandler(console or sys.stderr)
    term.setLevel(logging.WARNING)
    term.setFormatter(formatter)
    term.addFilter(no_stack)
    handlers: list[logging.Handler] = [term]
    path = None
    if log_dir is not None:
        log_dir.mkdir(parents=True, exist_ok=True)
        stem = f"run-{now().strftime('%Y%m%d-%H%M%S')}"
        path = log_dir / f"{stem}.jsonl"
        n = 1
        while path.exists():
            path = log_dir / f"{stem}-{n}.jsonl"
            n += 1
        file = logging.FileHandler(path, encoding="utf-8")
        file.setLevel(level.upper())
        file.setFormatter(formatter)
        file.addFilter(no_stack)
        handlers.insert(0, file)
    root = logging.getLogger()
    for old in root.handlers:
        with contextlib.suppress(Exception):
            old.close()
    root.handlers[:] = handlers
    root.setLevel(min(logging.getLevelName(level.upper()), logging.WARNING))
    for name in _QUIET:
        logging.getLogger(name).setLevel(logging.INFO)
    return path


# ---- 実行 ----


async def _drive(task: asyncio.Task[None], control: StopControl, stop_timeout_s: float) -> str:
    """pump が終わるか、止める旗が立つまで待つ。旗のあとは上限まで待ち、超えたら取り消す。"""
    while not task.done() and not control.stopping:
        await asyncio.wait({task}, timeout=POLL_S)
    if task.done():
        return "signal" if control.stopping else "eof"
    loop = asyncio.get_running_loop()
    deadline = loop.time() + stop_timeout_s
    while not task.done() and not control.forced and loop.time() < deadline:
        await asyncio.wait({task}, timeout=POLL_S)
    if task.done():
        return "signal"
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task
    return "forced"


async def serve(
    config: Config,
    deps: Deps,
    control: StopControl,
    *,
    ready: Callable[[RunInfo], None] | None = None,
    stop_timeout_s: float = STOP_TIMEOUT_S,
) -> RunResult:
    """起動して止まるまで動かす。起動できなければ StartupError（開けたものは閉じてから）。"""
    detector = _detector(
        config, deps
    )  # CoreML の初回のコンパイル（数十秒）の間の Ctrl-C は旗に残る
    source = StoppableSource(_source(config, deps), control)
    if control.stopping:  # 読み込み中に止められた: 待ち受けずに終わる
        source.close()
        logger.info("run.stopped", extra={"reason": "signal", "code": EXIT_OK})
        return RunResult(EXIT_OK, "signal")
    server: AlertServer | None = None
    service: CaptureService | None = None
    reason = "startup"
    try:
        hub = AlertHub(config.judge, tracker=config.tracker, l1=config.l1)
        server = AlertServer(hub, config.server)
        try:
            ws_port = await server.start()
        except ServerError as exc:
            raise StartupError(str(exc)) from exc
        try:
            service = deps.capture(config)
            capture_port = service.start() if service is not None else None
        except CaptureServerError as exc:
            raise StartupError(str(exc)) from exc
        except (OSError, ValueError) as exc:
            msg = f"capture を始められない（{type(exc).__name__}）"
            raise StartupError(msg) from exc
        results = process_frames(source, config, detector)
        if service is not None:
            results = service.wrap(results)
        l1 = deps.start_l1(
            config,
            hub,
            environ=deps.environ,
            observer=service.on_l1_answer if service is not None else None,
        )
        info = RunInfo(ws_port, capture_port, l1 is not None)
        logger.info("run.started", extra=_started_fields(config, info, service is not None))
        if ready is not None:
            ready(info)
        task = asyncio.create_task(pump(results, hub, background=[l1] if l1 is not None else []))
        reason = await _drive(task, control, stop_timeout_s)
        code = EXIT_OK
        if reason != "forced" and task.exception() is not None:
            reason, code = "error", EXIT_RUNTIME
            logger.critical("run.failed", extra={"error_type": type(task.exception()).__name__})
        logger.info("run.stopped", extra={"reason": reason, "code": code})
        return RunResult(code, reason)
    finally:
        # 片付けの順: capture（HTTP・保存のキュー）→ WebSocket → カメラ
        if service is not None:
            try:
                service.close()
            except Exception as exc:  # noqa: BLE001  片付けを続ける
                logger.error("capture.close_failed", extra={"error_type": type(exc).__name__})
        if server is not None:
            await server.stop()
        if reason != "forced":
            source.close()
        else:
            # 別のスレッドがまだ read() の中にいる。その VideoCapture を解放すると落ちうる
            # （入口は os._exit で抜け、OS がカメラを離す）
            logger.warning("camera.left_open", extra={"reason": "forced"})


def _started_fields(config: Config, info: RunInfo, capture: bool) -> dict[str, object]:
    cam = config.camera
    return {
        "model": Path(config.infer.model_path).name,  # パスは出さない
        "compute_units": config.coreml.compute_units,
        "target_fps": config.pipeline.target_fps,
        "camera_source": cam.source,
        "camera_size": f"{cam.width}x{cam.height}@{cam.fps}",
        "ws_port": info.ws_port,
        "capture_port": info.capture_port,
        "l1_enabled": info.l1,
        "capture_enabled": capture,
    }


def _probe_port(host: str, port: int, what: str) -> None:
    """待ち受けられるかを bind → close で確かめる（`--check`。待ち受けたままにしない）。"""
    family = socket.AF_INET6 if ":" in host else socket.AF_INET
    with socket.socket(family, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((host, port))
        except OSError as exc:
            msg = f"{what} の待ち受けを始められない: {host}:{port}（{type(exc).__name__}）"
            raise StartupError(msg) from exc


def check(config: Config, deps: Deps, image: Path | None = None) -> dict[str, object]:
    """設定・ポート・モデル・カメラ 1 枚（または画像）・推論 2 回。待ち受けない。"""
    _probe_port(config.server.host, config.server.port, "WebSocket")
    if config.capture.enabled:
        _probe_port(config.capture_server.host, config.capture_server.port, "capture")
    detector = _detector(config, deps)
    if image is not None:
        try:
            raw = deps.read_image(image)
        except SourceError as exc:
            raise StartupError(str(exc)) from exc
    else:
        source = _source(config, deps)
        try:
            frame = source.read()
        except SourceError as exc:
            raise StartupError(f"カメラから読めない: {exc}") from exc
        finally:
            _close_quietly(source)
        if frame is None:
            msg = "カメラ・動画から 1 枚も読めない"
            raise StartupError(msg)
        raw = frame.image
    try:
        resized = resize_frame(Frame(raw, datetime.now(UTC), 0))
    except ValueError as exc:
        raise StartupError(f"画像の形が違う: {exc}") from exc
    timings = []
    detections = []
    for _ in range(2):  # 1 回目は CoreML のコンパイルを含む
        started = perf_counter()
        detections = detector.detect(resized.image)
        timings.append(round((perf_counter() - started) * 1000.0, 1))
    return {
        "check": "ok",
        "model": Path(config.infer.model_path).name,
        "compute_units": config.coreml.compute_units,
        "frame_shape": list(raw.shape),
        "first_infer_ms": timings[0],
        "infer_ms": timings[1],
        "detections": [
            {"label": d.label, "conf": round(d.conf, 3), "xywh": [round(v, 3) for v in d.xywh]}
            for d in detections
        ],
        # 赤の閾値（judge.threshold）以上の鹿があるか。鹿の写真で false なら、モデルか向きを疑う
        "deer_detected": any(
            d.label == "deer" and d.conf >= config.judge.threshold for d in detections
        ),
        "l1_enabled": config.l1.enabled,
        "capture_enabled": config.capture.enabled,
    }


# ---- シグナルと CLI ----


def _say(text: str) -> None:
    sys.stderr.write(text + "\n")
    sys.stderr.flush()


def _hard_exit(
    code: int,
) -> None:  # pragma: no cover  サブプロセスのテストが通す（カバレッジに出ない）
    """read() が戻らないスレッドを待たずに抜ける。asyncio.run は既定の executor を待つため。"""
    logging.shutdown()
    os._exit(code)


def install_signal_handlers(
    loop: asyncio.AbstractEventLoop,
    control: StopControl,
    hard_exit: Callable[[int], None] = _hard_exit,
) -> Callable[[], None]:
    """SIGINT・SIGTERM の 1 回目で止める旗、2 回目ですぐ終わる（130）。

    戻り値はハンドラを外す関数。
    """
    sigs = (signal.SIGINT, signal.SIGTERM)

    def handle(name: str) -> None:
        if control.request(name) == "stop":
            _say("detector: 止めています（もう一度 Ctrl-C で強制終了）")
        else:
            _say("detector: 強制終了します")
            logger.info("run.stopped", extra={"reason": "killed", "code": EXIT_KILLED})
            hard_exit(EXIT_KILLED)

    for sig in sigs:
        loop.add_signal_handler(sig, handle, sig.name)

    def remove() -> None:
        for sig in sigs:
            loop.remove_signal_handler(sig)

    return remove


def _announce(config: Config, info: RunInfo) -> None:
    capture = (
        f"http://{config.capture_server.host}:{info.capture_port}"
        if info.capture_port is not None
        else "off"
    )
    _say(f"detector: ws://{config.server.host}:{info.ws_port}/alerts で待ち受けています")
    _say(f"  L1: {'on' if info.l1 else 'off'}  capture: {capture}  止める: Ctrl-C")


async def _run(config: Config, deps: Deps, control: StopControl) -> RunResult:
    remove = install_signal_handlers(asyncio.get_running_loop(), control)
    try:
        result = await serve(config, deps, control, ready=lambda info: _announce(config, info))
    finally:
        remove()
    if result.reason == "forced":
        _hard_exit(result.code)
    return result


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m detector",
        description="EZO ROAD B: 車載カメラの鹿検知を起動する（docs/specs/edge-run）",
    )
    p.add_argument("--config", type=Path, required=True, help="設定 TOML（config.example.toml）")
    p.add_argument("--no-l1", action="store_true", help="L1（local-jev）を使わない")
    p.add_argument("--no-capture", action="store_true", help="検知フレームを保存しない")
    p.add_argument(
        "--check", action="store_true", help="設定・モデル・カメラ 1 枚・推論を確かめて終わる"
    )
    p.add_argument("--image", type=Path, help="--check の推論にカメラの代わりに使う画像")
    p.add_argument(
        "--log-dir", type=Path, help="走行ログの置き場所（既定: 設定ファイルの隣の logs/）"
    )
    p.add_argument("--log-level", choices=LEVELS, default="INFO", help="ファイルに書く下限")
    return p


def _fail(message: str) -> int:
    _say(f"detector: {message}")
    return EXIT_STARTUP


def main(argv: list[str] | None = None, *, deps: Deps | None = None) -> int:
    args = _parser().parse_args(argv)
    deps = deps or Deps()
    if args.image is not None and not args.check:
        return _fail("--image は --check と一緒に使う")
    try:
        config = apply_overrides(
            load_config(args.config), no_l1=args.no_l1, no_capture=args.no_capture
        )
    except ConfigError as exc:
        return _fail(str(exc))
    if args.check:
        setup_logging(None)
        try:
            report = check(config, deps, args.image)
        except StartupError as exc:
            return _fail(str(exc))
        sys.stdout.write(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        return EXIT_OK
    log_dir = args.log_dir or Path(config.source_dir) / "logs"
    try:
        log_path = setup_logging(log_dir, args.log_level)
    except OSError as exc:
        return _fail(f"走行ログを書けない: {log_dir.name}/（{type(exc).__name__}）")
    install_excepthook()
    _say(f"detector: 走行ログ {log_path}")
    control = StopControl()
    try:
        result = asyncio.run(_run(config, deps, control))
    except StartupError as exc:
        logger.critical("run.stopped", extra={"reason": "startup", "code": EXIT_STARTUP})
        return _fail(str(exc))
    except KeyboardInterrupt:  # シグナルの受け口を付ける前の Ctrl-C
        logger.info("run.stopped", extra={"reason": "interrupted", "code": EXIT_KILLED})
        return EXIT_KILLED
    except Exception as exc:  # noqa: BLE001  想定外: ログには型名だけ、スタックは端末へ
        logger.critical(
            "run.stopped",
            extra={"reason": "crashed", "code": EXIT_RUNTIME, "error_type": type(exc).__name__},
        )
        traceback.print_exc(file=sys.stderr)
        return EXIT_RUNTIME
    if result.code != EXIT_OK:
        _say(f"detector: 途中で止まりました（{result.reason}）。走行ログ {log_path}")
    return result.code
