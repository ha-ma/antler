"""ローカルの保存（B2-5。docs/specs/edge-capture E4）。

`{id}.jpg` → `{id}.json` の順に、一時ファイルから os.replace で置く。**JSON が最後 = 完成のしるし**
（JSON のあるものだけが一覧に出る）。`{id}.uploaded` は送信済みの空のしるし。
id は `cap_` + 16 進 12 桁だけをパスに使う（`..`・`/` を通さない）。
ディレクトリは 0700、ファイルは 0600。
一覧は起動時に読んだ索引（メモリ）から返す。書くのはこのプロセスだけ（単独の書き手）。
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
import re
import secrets
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING

from detector.capture.model import valid_l1_probs

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable, Mapping

__all__ = ["CaptureStore", "StoreError", "valid_id"]

logger = logging.getLogger("detector.capture")

_ID_RE = re.compile(r"cap_[0-9a-f]{12}")
_DIR_MODE = 0o700
_FILE_MODE = 0o600


class StoreError(Exception):
    """保存できない（id が不正・重複・書き込みの失敗）。理由は型名とメッセージの短い語だけ。"""


def valid_id(value: object) -> bool:
    return isinstance(value, str) and _ID_RE.fullmatch(value) is not None


def _utc_now() -> datetime:
    return datetime.now(UTC)


class CaptureStore:
    def __init__(
        self,
        directory: Path,
        max_items: int = 2000,
        retention_hours: int = 24,
        now: Callable[[], datetime] = _utc_now,
    ) -> None:
        self._dir = Path(directory)
        self._max = max_items
        self._retention = timedelta(hours=retention_hours)
        self._now = now
        self._lock = threading.RLock()
        self._index: dict[str, dict[str, object]] = {}
        self._uploaded: set[str] = set()
        self._dir.mkdir(mode=_DIR_MODE, parents=True, exist_ok=True)
        # umask に左右されないよう、作ったあとに権限を決める
        self._dir.chmod(_DIR_MODE)
        self._load()
        with self._lock:
            self._expire()

    # --- 読み出し ---

    def has(self, capture_id: str) -> bool:
        with self._lock:
            return capture_id in self._index

    def list(
        self, limit: int = 200, *, pending: bool = False
    ) -> tuple[list[dict[str, object]], int]:
        """新しい順の最大 limit 件と、(pending なら未送信の、でなければ全体の) 件数。

        一覧のたびに保持期間を過ぎた未送信を消す（メモリの索引だけを見る。ディスクは走査しない）。
        """
        with self._lock:
            self._expire()
            chosen = [
                c for c in self._index.values() if not pending or str(c["id"]) not in self._uploaded
            ]
            chosen.sort(
                key=lambda c: (str(c.get("createdAt", "")), str(c.get("id", ""))), reverse=True
            )
            items = [
                {"capture": c, "uploaded": str(c["id"]) in self._uploaded}
                for c in chosen[: max(0, limit)]
            ]
            return items, len(chosen)

    def read_image(self, capture_id: str) -> bytes | None:
        if not valid_id(capture_id):
            return None
        with self._lock:
            if capture_id not in self._index:
                return None
        try:
            return (self._dir / f"{capture_id}.jpg").read_bytes()
        except OSError:
            return None

    # --- 書き込み ---

    def save(self, capture: Mapping[str, object], jpeg: bytes) -> None:
        """画像を置いてから JSON を置く。失敗したら置いたものを片づけて StoreError。"""
        capture_id = capture.get("id")
        if not valid_id(capture_id):
            msg = "id の形が違う"
            raise StoreError(msg)
        assert isinstance(capture_id, str)  # noqa: S101  valid_id が str を保証
        with self._lock:
            if capture_id in self._index:
                msg = "同じ id がある"
                raise StoreError(msg)
            image_path = self._dir / f"{capture_id}.jpg"
            json_path = self._dir / f"{capture_id}.json"
            try:
                self._write_atomic(image_path, jpeg)
                self._write_atomic(json_path, _dump(capture))
            except OSError as exc:
                with contextlib.suppress(OSError):
                    image_path.unlink(missing_ok=True)
                msg = f"書き込みに失敗: {type(exc).__name__}"
                raise StoreError(msg) from exc
            self._index[capture_id] = dict(capture)
            self._evict()

    def set_consent(self, ids: Iterable[str], consent: bool) -> int:
        """同意を書く。送信済みは変えない。変わった件数を返す（同じ値の再送は 0）。

        consent=False は「提供しない」: 未送信の画像と JSON を消す（次の起動・次の人に出さない）。
        """
        changed = 0
        with self._lock:
            for capture_id in ids:
                if not valid_id(capture_id) or capture_id in self._uploaded:
                    continue
                capture = self._index.get(capture_id)
                if capture is None:
                    continue
                if not consent:
                    self._delete(capture_id)
                    changed += 1
                    continue
                if capture.get("consent") is True:
                    continue
                if self._rewrite(capture_id, {**capture, "consent": True}):
                    changed += 1
        return changed

    def mark_uploaded(self, ids: Iterable[str]) -> int:
        """送信済みのしるしを付ける。同意のあるものだけ。付けた件数を返す。"""
        marked = 0
        with self._lock:
            for capture_id in ids:
                capture = self._index.get(capture_id) if valid_id(capture_id) else None
                if capture is None or capture.get("consent") is not True:
                    continue
                if capture_id in self._uploaded:
                    continue
                try:
                    self._write_atomic(self._dir / f"{capture_id}.uploaded", b"")
                except OSError as exc:
                    logger.warning("capture.failed", extra={"error_type": type(exc).__name__})
                    continue
                self._uploaded.add(capture_id)
                marked += 1
        return marked

    def attach_l1_probs(self, capture_id: str, probs: Mapping[str, object]) -> bool:
        """l1Probs を一度だけ書き足す（すでにあれば何もしない）。os.replace で原子的。"""
        checked = valid_l1_probs(dict(probs))
        if checked is None or not valid_id(capture_id):
            return False
        with self._lock:
            capture = self._index.get(capture_id)
            if capture is None or "l1Probs" in capture:
                return False
            return self._rewrite(capture_id, {**capture, "l1Probs": checked})

    def l1_missing(self, capture_id: str) -> bool:
        with self._lock:
            capture = self._index.get(capture_id)
            return capture is not None and "l1Probs" not in capture

    # --- 内部 ---

    def _rewrite(self, capture_id: str, capture: dict[str, object]) -> bool:
        try:
            self._write_atomic(self._dir / f"{capture_id}.json", _dump(capture))
        except OSError as exc:
            logger.warning("capture.failed", extra={"error_type": type(exc).__name__})
            return False
        self._index[capture_id] = capture
        return True

    def _write_atomic(self, path: Path, data: bytes) -> None:
        """一時ファイルに書いて os.replace で置く。失敗したら一時ファイルを消す。"""
        tmp = self._dir / f".tmp-{path.stem}-{secrets.token_hex(4)}{path.suffix}"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, _FILE_MODE)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp, path)  # noqa: PTH105  テストが os.replace を差し替える
        except BaseException:
            with contextlib.suppress(OSError):
                tmp.unlink(missing_ok=True)
            raise

    def _delete(self, capture_id: str) -> None:
        """JSON を先に消す（完成のしるしが先に無くなる）。画像・しるしの失敗は無視する。"""
        for suffix in (".json", ".jpg", ".uploaded"):
            with contextlib.suppress(OSError):
                (self._dir / f"{capture_id}{suffix}").unlink(missing_ok=True)
        self._index.pop(capture_id, None)
        self._uploaded.discard(capture_id)

    def _evict(self) -> None:
        """max_items を超えたら、送信済みの古いものから（無ければ全体で古いものから）消す。"""
        while len(self._index) > self._max:
            by_age = sorted(self._index, key=lambda i: (str(self._index[i].get("createdAt")), i))
            victim = next((i for i in by_age if i in self._uploaded), by_age[0])
            self._delete(victim)
            logger.info("capture.evicted", extra={"id": victim})

    def _expire(self) -> None:
        """保持期間を過ぎた未送信を消す（createdAt が読めないものは消さない）。"""
        cutoff = self._now() - self._retention
        for capture_id in list(self._index):
            if capture_id in self._uploaded:
                continue
            created = _parse_time(self._index[capture_id].get("createdAt"))
            if created is not None and created < cutoff:
                self._delete(capture_id)
                logger.info("capture.expired", extra={"id": capture_id})

    def _load(self) -> None:
        """起動時: 一時ファイルと孤児を消し、完成品の索引を作る。知らないファイルは触らない。"""
        names = [p.name for p in self._dir.iterdir()]
        for name in names:
            if name.startswith(".tmp-"):
                with contextlib.suppress(OSError):
                    (self._dir / name).unlink()
        for name in sorted(names):
            if not name.endswith(".json"):
                continue
            stem = name[: -len(".json")]
            if not valid_id(stem):
                continue
            try:
                data = json.loads((self._dir / name).read_text(encoding="utf-8"))
            except (OSError, ValueError) as exc:
                logger.warning("capture.corrupt", extra={"error_type": type(exc).__name__})
                continue
            if not isinstance(data, dict) or data.get("id") != stem:
                logger.warning("capture.corrupt", extra={"error_type": "IdMismatch"})
                continue
            if not (self._dir / f"{stem}.jpg").is_file():
                continue
            self._index[stem] = data
            if (self._dir / f"{stem}.uploaded").is_file():
                self._uploaded.add(stem)
        for name in names:
            stem, dot, suffix = name.partition(".")
            if dot and valid_id(stem) and suffix in ("jpg", "uploaded") and stem not in self._index:
                with contextlib.suppress(OSError):
                    (self._dir / name).unlink()


def _parse_time(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else None


def _dump(capture: Mapping[str, object]) -> bytes:
    return json.dumps(capture, ensure_ascii=False, allow_nan=False).encode("utf-8")
