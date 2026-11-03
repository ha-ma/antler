"""CL-1: typesafe-sdk のクライアント（edge-l1 R3）。

実物の SDK を httpx2.MockTransport 越しに使う。
"""

import asyncio
import builtins
import json

import httpx2
import pytest

from detector.l1.client import (
    L1Unavailable,
    endpoint_fields,
    is_loopback,
    make_client,
    resolve_base_url,
)
from detector.l1.questions import QUESTION_IDS
from detector.schema import JUDGE_QUESTIONS, JudgeRequest

from .l1_fakes import MODEL, JevServer, jev_body

URL = "http://127.0.0.1:8766"


def request() -> JudgeRequest:
    return JudgeRequest.model_validate(
        {
            "model": "jev-latest",
            "state": {
                "speedKmh": 60.0,
                "zone": "inside",
                "light": "night",
                "headlight": "low",
                "track": [
                    {
                        "t": -0.4,
                        "conf": 0.9,
                        "distanceM": 20.0,
                        "lateralMps": 0.5,
                        "side": "L",
                        "pos": "shoulder",
                    },
                    {
                        "t": 0.0,
                        "conf": 0.92,
                        "distanceM": 18.0,
                        "lateralMps": 0.6,
                        "side": "L",
                        "pos": "shoulder",
                    },
                ],
                "ttcSec": None,
                "recentAlerts30s": 1,
            },
            "questions": list(JUDGE_QUESTIONS),
        }
    )


def judge(transport, timeout_ms: int = 800, environ=None):
    async def main():
        client = make_client(URL, timeout_ms, environ or {}, transport)
        try:
            return await client.judge(request())
        finally:
            await client.aclose()

    return asyncio.run(asyncio.wait_for(main(), 10))


# CL-1a
def test_cl1a_1回のPOSTにmodel状態4問が入りリトライしない():
    jev = JevServer()
    judge(jev.transport)
    assert len(jev.requests) == 1
    req = jev.requests[0]
    assert req.method == "POST" and str(req.url) == f"{URL}/v1/systemone"
    body = json.loads(req.content)
    assert body["model"] == "jev-latest"
    assert body["state"]["ttcSec"] is None and len(body["state"]["track"]) == 2
    assert list(body["questions"]) == list(QUESTION_IDS)
    assert body["questions"]["false_positive"]["instructions"] == JUDGE_QUESTIONS[3]["text"]
    assert req.headers["authorization"] == "Bearer local"
    failing = JevServer(status=500, body={"detail": "boom"})
    with pytest.raises(L1Unavailable):
        judge(failing.transport)
    assert len(failing.requests) == 1  # リトライしない


# CL-1b
def test_cl1b_答えを読む():
    jev = JevServer(body=jev_body({"none": 0.1, "zone": 0.7, "danger": 0.2}, 0.3, 0.6, 0.05))
    a = judge(jev.transport)
    assert a.model == MODEL
    assert a.alert_level == {"none": 0.1, "zone": 0.7, "danger": 0.2}
    assert (a.on_roadway, a.static_shoulder, a.false_positive) == (0.3, 0.6, 0.05)


def broken(mutate):
    body = jev_body()
    mutate(body)
    return body


# CL-1c
@pytest.mark.parametrize(
    "body",
    [
        broken(lambda b: b["answers"].pop("false_positive")),
        broken(lambda b: b["answers"]["alert_level"]["probabilities"].pop("none")),
        broken(lambda b: b["answers"]["on_roadway"].update(noul=1.5)),
        broken(lambda b: b["answers"]["on_roadway"].update(type="choice")),
        broken(lambda b: b.pop("model")),
        broken(lambda b: b.update(model="")),
        {"unexpected": True},
    ],
)
def test_cl1c_欠落型違い範囲外はbad_response(body):
    with pytest.raises(L1Unavailable) as err:
        judge(JevServer(body=body).transport)
    assert err.value.reason == "bad_response"


# CL-1d
def test_cl1d_HTTPのエラー接続できないタイムアウト():
    with pytest.raises(L1Unavailable) as err:
        judge(JevServer(status=503, body={"detail": "model_unavailable"}).transport)
    assert err.value.reason == "http"

    def refuse(request):
        raise httpx2.ConnectError("refused", request=request)

    with pytest.raises(L1Unavailable) as err:
        judge(httpx2.MockTransport(refuse))
    assert err.value.reason == "connect"

    async def slow(request):
        await asyncio.sleep(0.5)
        return httpx2.Response(200, json=jev_body())

    with pytest.raises(L1Unavailable) as err:
        judge(httpx2.MockTransport(slow), timeout_ms=50)
    assert err.value.reason == "timeout"


# CL-1e
def test_cl1e_接続先は環境変数が優先しAPIキーは環境変数かlocal():
    assert resolve_base_url("http://127.0.0.1:8766", {}) == "http://127.0.0.1:8766"
    assert (
        resolve_base_url("http://127.0.0.1:8766/", {"TYPESAFE_BASE_URL": "  "})
        == "http://127.0.0.1:8766"
    )
    env = {"TYPESAFE_BASE_URL": " http://localhost:9000/ "}
    assert resolve_base_url("http://127.0.0.1:8766", env) == "http://localhost:9000"
    jev = JevServer()
    judge(jev.transport, environ={"TYPESAFE_API_KEY": "k123"})
    assert jev.requests[0].headers["authorization"] == "Bearer k123"


def test_cl1e_ループバックだけ():
    assert is_loopback("http://127.0.0.1:8766")
    assert is_loopback("http://[::1]:8766")
    assert is_loopback("https://localhost")
    assert not is_loopback("https://api.typesafe.ai")
    assert not is_loopback("http://192.168.1.20:8766")
    assert not is_loopback("ftp://127.0.0.1")
    assert not is_loopback("http://127.0.0.1:99999")
    assert not is_loopback("")
    with pytest.raises(L1Unavailable) as err:
        make_client("https://api.typesafe.ai", 800, {})
    assert err.value.reason == "remote_not_allowed"


# CL-1f
def test_cl1f_SDKがimportできなければsdk_missing(monkeypatch):
    real = builtins.__import__

    def fake(name, *args, **kw):
        if name == "typesafe_sdk":
            raise ImportError(name)
        return real(name, *args, **kw)

    monkeypatch.setattr(builtins, "__import__", fake)
    with pytest.raises(L1Unavailable) as err:
        make_client(URL, 800, {})
    assert err.value.reason == "sdk_missing"


# LOG-1a（接続先のログ）
def test_log1a_endpointはschemeとhostとportだけ():
    fields = endpoint_fields("http://user:secret@127.0.0.1:8766/v1/x?k=1")
    assert fields == {"scheme": "http", "host": "127.0.0.1", "port": 8766}
    assert "secret" not in json.dumps(fields)
