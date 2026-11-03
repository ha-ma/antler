"""構造化ログ（JSON 1 行）と未捕捉例外のフック。

走行ログ（検知・遅延・切断）もこの形で残す。遅延の計測に使う t_frame / t_sent は
呼び出し側が extra に入れる（ch6「B 遅延」、edge-latency-reviewer が読む）。
外部の解析サービスには送らない（ch6「計測」）。
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import UTC, datetime
from typing import TYPE_CHECKING, TextIO

if TYPE_CHECKING:
    from types import TracebackType

_RESERVED = set(logging.makeLogRecord({}).__dict__) | {"message", "asctime"}


class JsonFormatter(logging.Formatter):
    """LogRecord を 1 行の JSON にする。logger.info("event", extra={...}) の extra を項目にする。"""

    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, object] = {
            "ts": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname.lower(),
            "event": record.getMessage(),
            "logger": record.name,
        }
        for key, value in record.__dict__.items():
            if key not in _RESERVED and not key.startswith("_"):
                entry[key] = value
        if record.exc_info and record.exc_info[1] is not None:
            error = record.exc_info[1]
            entry["error"] = {
                "name": type(error).__name__,
                "message": str(error),
                "stack": self.formatException(record.exc_info),
            }
        return json.dumps(entry, ensure_ascii=False, default=str)


def configure_logging(level: str = "INFO", stream: TextIO | None = None) -> logging.Logger:
    """ルートの logger を JSON 出力にする。起動時に 1 回呼ぶ。"""
    handler = logging.StreamHandler(stream or sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level.upper())
    return root


def install_excepthook(logger: logging.Logger | None = None) -> None:
    """未捕捉の例外を JSON で記録してから終了させる（黙って落ちない）。"""
    target = logger or logging.getLogger("detector")

    def hook(
        exc_type: type[BaseException],
        exc: BaseException,
        tb: TracebackType | None,
    ) -> None:
        target.critical("process.uncaught", exc_info=(exc_type, exc, tb))

    sys.excepthook = hook
