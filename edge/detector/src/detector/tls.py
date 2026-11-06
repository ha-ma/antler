"""TLS の設定から SSLContext を作る（docs/specs/pwa-https R2）。

`[tls]` の cert と key がどちらも空なら TLS を使わない（ws / http。開発用）。そのとき
`tls.disabled` を warn に 1 回残す（https の PWA からは届かないことを運用者に見せる）。
壊れた設定では TlsError を上げ、**平文に黙って戻らない**。ログと例外の文に、パスと鍵の中身を
出さない。
"""

from __future__ import annotations

import logging
import ssl
from typing import TYPE_CHECKING

from detector.config import resolve_path

if TYPE_CHECKING:
    from pathlib import Path

    from detector.config import Config

__all__ = ["TlsError", "enabled", "server_context"]

logger = logging.getLogger("detector.tls")


class TlsError(Exception):
    """TLS の設定で待ち受けを始められない（ファイルが無い・壊れている・鍵と証明書が合わない）。"""


def enabled(config: Config) -> bool:
    return bool(config.tls.cert.strip() and config.tls.key.strip())


def _loose(path: Path) -> bool:
    try:
        return bool(path.stat().st_mode & 0o077)
    except OSError:
        return False  # 読めないなら load_cert_chain が TlsError にする


def server_context(config: Config) -> ssl.SSLContext | None:
    """サーバー用の SSLContext（TLS 1.2 以上）。TLS を使わない設定なら None。"""
    if not enabled(config):
        logger.warning("tls.disabled")
        return None
    cert = resolve_path(config, config.tls.cert)
    key = resolve_path(config, config.tls.key)
    if _loose(key):
        logger.warning("tls.key_permissions")  # 起動は止めない（runbook で chmod 600）
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    try:
        context.load_cert_chain(certfile=cert, keyfile=key)
    except FileNotFoundError as exc:
        logger.critical("tls.failed", extra={"reason": "missing"})
        msg = "TLS の証明書か鍵のファイルが無い（[tls] の cert・key を確かめる）"
        raise TlsError(msg) from exc
    except ssl.SSLError as exc:
        logger.critical("tls.failed", extra={"reason": "invalid"})
        msg = "TLS の証明書か鍵が読めないか、対になっていない（make_tls.py で作り直す）"
        raise TlsError(msg) from exc
    except OSError as exc:
        logger.critical("tls.failed", extra={"reason": type(exc).__name__})
        msg = "TLS の証明書か鍵を読めない（権限を確かめる）"
        raise TlsError(msg) from exc
    return context
