"""edge-l1 のテストの部品: local-jev の形で答える偽のサーバーと偽のクライアント。

偽のサーバーは httpx2.MockTransport。応答の形は local-jev の README
（github.com/amithgc/local-jev @ 64a0b31）の `POST /v1/systemone` の例どおり。
"""

from __future__ import annotations

import asyncio
import json
import socket
from dataclasses import dataclass, field

import httpx2

from detector.l1.client import L1Answer, L1Unavailable

MODEL = "llm-qwen2.5-1.5b"


def jev_body(
    levels: dict[str, float] | None = None,
    on_roadway: float = 0.2,
    static_shoulder: float = 0.1,
    false_positive: float = 0.05,
    model: str = MODEL,
) -> dict:
    probs = levels or {"none": 0.05, "zone": 0.15, "danger": 0.8}
    best = max(probs, key=probs.get)
    return {
        "model": model,
        "answers": {
            "alert_level": {
                "type": "choice",
                "choice": best,
                "confidence": 0.5,
                "probabilities": probs,
            },
            "on_roadway": {"type": "noul", "noul": on_roadway},
            "static_shoulder": {"type": "noul", "noul": static_shoulder},
            "false_positive": {"type": "noul", "noul": false_positive},
        },
        "usage": {"input_tokens": 120, "output_tokens": 4},
    }


@dataclass
class JevServer:
    """MockTransport の handler。受けたリクエストを残す。"""

    body: dict = field(default_factory=jev_body)
    status: int = 200
    requests: list[httpx2.Request] = field(default_factory=list)

    def __call__(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        return httpx2.Response(self.status, json=self.body)

    def payloads(self) -> list[dict]:
        return [json.loads(r.content) for r in self.requests]

    @property
    def transport(self) -> httpx2.MockTransport:
        return httpx2.MockTransport(self)


def closed_port() -> int:
    """閉じた（誰も待ち受けていない）ポート。8765・8787・5173 は使わない。"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def answer(
    levels: dict[str, float] | None = None,
    false_positive: float = 0.05,
    model: str = MODEL,
    on_roadway: float = 0.2,
    static_shoulder: float = 0.1,
) -> L1Answer:
    return L1Answer(
        model=model,
        alert_level=levels or {"none": 0.05, "zone": 0.15, "danger": 0.8},
        on_roadway=on_roadway,
        static_shoulder=static_shoulder,
        false_positive=false_positive,
    )


class FakeClient:
    """script の要素を順に返す（L1Answer か例外。尽きたら最後を繰り返す）。delay 秒かける。"""

    def __init__(self, script: list, delay: float = 0.0) -> None:
        self.script = list(script)
        self.delay = delay
        self.requests: list = []
        self.in_flight = 0
        self.max_in_flight = 0

    async def judge(self, request):
        self.requests.append(request)
        self.in_flight += 1
        self.max_in_flight = max(self.max_in_flight, self.in_flight)
        try:
            if self.delay:
                await asyncio.sleep(self.delay)
            item = self.script.pop(0) if len(self.script) > 1 else self.script[0]
            if isinstance(item, BaseException):
                raise item
            return item
        finally:
            self.in_flight -= 1

    async def aclose(self) -> None:
        return None


def unavailable(reason: str = "connect") -> L1Unavailable:
    return L1Unavailable(reason, "Fake")
