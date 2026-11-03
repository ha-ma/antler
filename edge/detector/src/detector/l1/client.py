"""L1 のクライアント（B2-4）: typesafe-sdk で local-jev に 4 問を 1 回で聞く。

`POST /v1/systemone`。
- 接続先は環境変数 TYPESAFE_BASE_URL、無ければ設定の l1.base_url。SDK の既定（クラウド）は使わない
- ループバックの接続先だけ（オフライン前提。車外へ状態とキーを送らない）
- リトライしない。タイムアウトは timeout_ms（SDK と asyncio.timeout の両方）。圧縮しない
- 失敗はすべて L1Unavailable（理由つき）にして返す。呼び出し側（runner）は L0 だけで動き続ける
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import math
import os
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol
from urllib.parse import urlsplit

from detector.l1.questions import ALERT_LEVELS, NOUL_IDS, wire_questions

if TYPE_CHECKING:
    from collections.abc import Mapping

    from detector.schema import JudgeRequest

__all__ = [
    "BASE_URL_ENV",
    "JudgeClient",
    "L1Answer",
    "L1Unavailable",
    "TypesafeJudgeClient",
    "endpoint_fields",
    "is_loopback",
    "make_client",
    "resolve_base_url",
]

BASE_URL_ENV = "TYPESAFE_BASE_URL"
API_KEY_ENV = "TYPESAFE_API_KEY"
# SDK はキーを必須にしている。local-jev は LOCAL_JEV_API_KEY が無ければキーを見ない（秘密ではない）
LOCAL_API_KEY = "local"
LOOPBACK_NAMES = ("localhost",)


class L1Unavailable(Exception):  # 名前は仕様の語（l1_unavailable）に合わせる
    """L1 が使えない。reason はログに出す短い語（timeout / connect / http / bad_response など）。"""

    def __init__(self, reason: str, error_type: str | None = None) -> None:
        super().__init__(reason)
        self.reason = reason
        self.error_type = error_type


@dataclass(frozen=True)
class L1Answer:
    """L1 の答え（校正前の確率）。model は実際に答えたモデル（local-jev の応答の model）。"""

    model: str
    alert_level: dict[str, float]  # none / zone / danger
    on_roadway: float
    static_shoulder: float
    false_positive: float


class JudgeClient(Protocol):
    async def judge(self, request: JudgeRequest) -> L1Answer: ...


def resolve_base_url(config_url: str, environ: Mapping[str, str] | None = None) -> str:
    """環境変数（空白だけは無視）があればそれ、無ければ設定の値。末尾の / は除く。"""
    env = (os.environ if environ is None else environ).get(BASE_URL_ENV, "").strip()
    return (env or config_url.strip()).rstrip("/")


def is_loopback(url: str) -> bool:
    try:
        parts = urlsplit(url)
        host = parts.hostname
        _ = parts.port  # 不正なポートは ValueError
    except ValueError:
        return False
    if parts.scheme not in ("http", "https") or not host:
        return False
    if host in LOOPBACK_NAMES:
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def endpoint_fields(url: str) -> dict[str, object]:
    """ログに出す接続先（scheme・host・port だけ。認証情報・パスは出さない）。"""
    parts = urlsplit(url)
    return {"scheme": parts.scheme, "host": parts.hostname, "port": parts.port}


def _probability(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise L1Unavailable("bad_response")
    p = float(value)
    if not (math.isfinite(p) and 0.0 <= p <= 1.0):
        raise L1Unavailable("bad_response")
    return p


def parse_answer(
    model: object, choices: Mapping[str, object], nouls: Mapping[str, object]
) -> L1Answer:
    """SDK の応答（choices・nouls）から 4 問の答えを読む。欠落・範囲外 → bad_response。"""
    if not isinstance(model, str) or not model:
        raise L1Unavailable("bad_response")
    choice = choices.get("alert_level")
    probs = getattr(choice, "probabilities", None)
    if not isinstance(probs, dict) or set(probs) != set(ALERT_LEVELS):
        raise L1Unavailable("bad_response")
    levels = {level: _probability(probs[level]) for level in ALERT_LEVELS}
    noul = {}
    for qid in NOUL_IDS:
        answer = nouls.get(qid)
        if answer is None:
            raise L1Unavailable("bad_response")
        noul[qid] = _probability(getattr(answer, "noul", None))
    return L1Answer(
        model=model,
        alert_level=levels,
        on_roadway=noul["on_roadway"],
        static_shoulder=noul["static_shoulder"],
        false_positive=noul["false_positive"],
    )


class TypesafeJudgeClient:
    """typesafe-sdk の AsyncTypeSafeClient を包む。1 つの問い合わせに 1 回の POST。"""

    def __init__(self, sdk: object, client: object, timeout_ms: int) -> None:
        self._sdk = sdk
        self._client = client
        self._timeout_s = timeout_ms / 1000.0

    async def judge(self, request: JudgeRequest) -> L1Answer:
        sdk = self._sdk
        try:
            async with asyncio.timeout(self._timeout_s):
                result = await self._client.system_one(  # type: ignore[attr-defined]
                    state=request.state.model_dump(mode="json"),
                    questions=wire_questions(),
                    model=request.model,
                    timeout=self._timeout_s,
                )
        except TimeoutError as exc:
            raise L1Unavailable("timeout", type(exc).__name__) from exc
        except sdk.TypeSafeAPITimeoutError as exc:  # type: ignore[attr-defined]
            raise L1Unavailable("timeout", type(exc).__name__) from exc
        except sdk.TypeSafeAPIConnectionError as exc:  # type: ignore[attr-defined]
            raise L1Unavailable("connect", type(exc).__name__) from exc
        except sdk.TypeSafeAPIResponseValidationError as exc:  # type: ignore[attr-defined]
            raise L1Unavailable("bad_response", type(exc).__name__) from exc
        except sdk.TypeSafeAPIError as exc:  # type: ignore[attr-defined]
            raise L1Unavailable("http", type(exc).__name__) from exc
        except sdk.TypeSafeError as exc:  # type: ignore[attr-defined]
            raise L1Unavailable("error", type(exc).__name__) from exc
        return parse_answer(
            getattr(result, "model", None),
            getattr(result, "choices", {}),
            getattr(result, "nouls", {}),
        )

    async def aclose(self) -> None:
        await self._client.aclose()  # type: ignore[attr-defined]


def make_client(
    base_url: str,
    timeout_ms: int,
    environ: Mapping[str, str] | None = None,
    transport: object | None = None,
) -> TypesafeJudgeClient:
    """SDK のクライアントを作る。

    SDK が無い → sdk_missing、ループバックでない → remote_not_allowed。
    """
    if not is_loopback(base_url):
        raise L1Unavailable("remote_not_allowed")
    try:
        import typesafe_sdk  # 入っていなくても L0 は動く（任意の依存。ここで遅れて読む）
    except ImportError as exc:
        raise L1Unavailable("sdk_missing", type(exc).__name__) from exc
    # SDK は debug で本文を出す。本文（状態）をログに残さない
    logging.getLogger("typesafe_sdk").setLevel(logging.WARNING)
    env = os.environ if environ is None else environ
    api_key = env.get(API_KEY_ENV, "").strip() or LOCAL_API_KEY
    try:
        client = typesafe_sdk.AsyncTypeSafeClient(
            api_key=api_key,
            base_url=base_url,
            retry=typesafe_sdk.RetryPolicy(max_retries=0),
            timeout=timeout_ms / 1000.0,
            compression=False,
            transport=transport,
        )
    except typesafe_sdk.TypeSafeError as exc:
        raise L1Unavailable("error", type(exc).__name__) from exc
    return TypesafeJudgeClient(typesafe_sdk, client, timeout_ms)
