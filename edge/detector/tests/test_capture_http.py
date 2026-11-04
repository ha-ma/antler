"""capture.http（docs/specs/edge-capture UC-6）: PWA 向けの HTTP。Host・Origin・本文の制限。

Test List: HTTP-1a HTTP-1b HTTP-1c HTTP-1d HTTP-1e（同時接続と打ち切り: AUTH_11）HTTP-1f HTTP-1g
HTTP-1h HTTP-1i HTTP-1j HTTP-1k
認可: AUTH-7 AUTH-8 AUTH-10（HTTP_1b）AUTH-11 AUTH-13、障害: FAIL-7
"""

from __future__ import annotations

import http.client
import json
import socket
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from detector.capture.http import CaptureApi, CaptureServer, CaptureServerError
from detector.capture.model import build_capture
from detector.capture.store import CaptureStore
from detector.config import CaptureServerConfig, JudgeConfig
from detector.ports import Detection

JST = timezone(timedelta(hours=9))
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00fake-image\xff\xd9"
PWA = "http://ezoroad.local:5174"
ID1, ID2, ID3 = "cap_000000000001", "cap_000000000002", "cap_000000000003"


def make_capture(n: int) -> dict:
    return build_capture(
        capture_id=f"cap_{n:012x}",
        detections=[Detection("deer", 0.9, (0.3, 0.5, 0.1, 0.2))],
        t_frame=datetime(2027, 2, 15, 16, 30, 0, tzinfo=JST) + timedelta(seconds=n),
        image_size=(320, 240),
        distance_table=JudgeConfig().distance_table,
        min_box_conf=0.4,
    )


@pytest.fixture
def store(tmp_path: Path) -> CaptureStore:
    s = CaptureStore(tmp_path / "captures", max_items=3000)
    for n in (1, 2, 3):
        s.save(make_capture(n), JPEG)
    return s


def api_for(
    store: CaptureStore, origins: tuple[str, ...] = (), idle: float | None = 120.0
) -> CaptureApi:
    return CaptureApi(store, lambda: idle, origins)


def call(
    api: CaptureApi,
    method: str,
    target: str,
    *,
    host: str | None = "ezoroad.local:8767",
    origin: str | None = None,
    content_type: str | None = None,
    body: bytes = b"",
    length: int | None = None,
) -> tuple[int, dict[str, str], bytes]:
    headers: dict[str, str] = {}
    if host is not None:
        headers["host"] = host
    if origin is not None:
        headers["origin"] = origin
    if content_type is not None:
        headers["content-type"] = content_type
    headers["content-length"] = str(len(body) if length is None else length)
    response = api.handle(method, target, headers, body)
    return response.status, {k.lower(): v for k, v in response.headers.items()}, response.body


def jbody(body: bytes) -> dict:
    return json.loads(body.decode("utf-8"))


def post(api: CaptureApi, path: str, payload: object, **kw: object) -> tuple[int, dict, dict]:
    status, headers, body = call(
        api,
        "POST",
        path,
        content_type="application/json",
        body=json.dumps(payload).encode(),
        **kw,  # type: ignore[arg-type]
    )
    return status, headers, jbody(body) if body else {}


def test_HTTP_1a_一覧は新しい順でuploadedとtotalとidleSecondsを含む(store: CaptureStore) -> None:
    api = api_for(store, idle=90.5)
    status, headers, body = call(api, "GET", "/captures")
    data = jbody(body)
    assert status == 200
    assert headers["content-type"].startswith("application/json")
    assert headers["cache-control"] == "no-store"
    assert [i["capture"]["id"] for i in data["items"]] == [ID3, ID2, ID1]
    assert all(i["uploaded"] is False for i in data["items"])
    assert data["total"] == 3
    assert data["idleSeconds"] == 90.5
    _, _, none_body = call(api_for(store, idle=None), "GET", "/captures")
    assert jbody(none_body)["idleSeconds"] is None


def test_HTTP_1a_limitは既定200で最大500_不正は400(store: CaptureStore) -> None:
    api = api_for(store)
    assert len(jbody(call(api, "GET", "/captures?limit=2")[2])["items"]) == 2
    assert len(jbody(call(api, "GET", "/captures?limit=500")[2])["items"]) == 3
    for bad in ("0", "501", "-1", "abc", ""):
        assert call(api, "GET", f"/captures?limit={bad}")[0] == 400, bad
    assert call(api, "GET", "/captures?pending=maybe")[0] == 400


def test_HTTP_1b_画像はimage_jpegで返し不正や存在しないidは404でパスを返さない(
    store: CaptureStore,
) -> None:
    api = api_for(store)
    status, headers, body = call(api, "GET", f"/captures/{ID1}/image")
    assert (status, headers["content-type"], body) == (200, "image/jpeg", JPEG)
    assert headers["x-content-type-options"] == "nosniff"
    for bad in ("cap_0000000000ff", "..", "%2e%2e", "cap_ABCDEF012345", f"{ID1}%2f..%2f.."):
        status, _, body = call(api, "GET", f"/captures/{bad}/image")
        assert status == 404, bad
        message = jbody(body)["error"]["message"]
        assert "/" not in message  # パスや入力を返さない
        assert bad not in message
    assert call(api, "GET", "/captures/../etc/passwd")[0] == 404


def test_HTTP_1c_深いJSONの入れ子は400で500にならない(store: CaptureStore) -> None:
    api = api_for(store)
    nested = b"[" * 4000 + b"]" * 4000
    status, _, _ = call(
        api, "POST", "/captures/consent", content_type="application/json", body=nested
    )
    assert status == 400


def test_HTTP_1c_isdigitがTrueでもintにできない文字で500にならない(store: CaptureStore) -> None:
    api = api_for(store)
    # "²".isdigit() は True だが int("²") は ValueError。400 と 411 になる（500 や例外にしない）
    assert call(api, "GET", "/captures?limit=%C2%B2")[0] == 400
    assert call(api, "GET", "/captures?limit=２")[0] == 400  # 全角
    status, _, _ = call(
        api, "POST", "/captures/consent", content_type="application/json", body=b"{}", length=None
    )
    assert status != 500
    headers = {"host": "ezoroad.local", "content-type": "application/json", "content-length": "²"}
    assert api.handle("POST", "/captures/consent", headers, b"{}").status == 411


def test_HTTP_1c_POSTの本文の検証(store: CaptureStore) -> None:
    api = api_for(store)
    ok = post(api, "/captures/consent", {"consent": True, "ids": [ID1]})
    assert ok[0] == 200
    assert ok[2] == {"updated": 1}
    bad_bodies = [
        {"consent": True, "ids": []},
        {"consent": True, "ids": [f"cap_{i:012x}" for i in range(201)]},
        {"consent": True, "ids": ["../etc"]},
        {"consent": True, "ids": [5]},
        {"consent": "yes", "ids": [ID1]},
        {"ids": [ID1]},
        {"consent": True, "ids": [ID1], "extra": 1},
        [ID1],
    ]
    for payload in bad_bodies:
        assert post(api, "/captures/consent", payload)[0] == 400, payload
    assert post(api, "/captures/uploaded", {"ids": []})[0] == 400
    assert post(api, "/captures/uploaded", {"ids": [ID1], "consent": True})[0] == 400
    status, _, _ = call(
        api, "POST", "/captures/consent", content_type="application/json", body=b"{x"
    )
    assert status == 400
    # 型違いは 415、大きい本文は 413、長さ不明は 411
    for ctype in ("text/plain", "multipart/form-data", "application/x-www-form-urlencoded", None):
        status, _, _ = call(api, "POST", "/captures/consent", content_type=ctype, body=b"{}")
        assert status == 415, ctype
    big = json.dumps({"consent": True, "ids": [ID1], "pad": "x" * 9000}).encode()
    assert (
        call(api, "POST", "/captures/consent", content_type="application/json", body=big)[0] == 413
    )
    assert (
        call(
            api,
            "POST",
            "/captures/consent",
            content_type="application/json",
            body=b"{}",
            length=9000,
        )[0]
        == 413
    )
    assert (
        call(
            api,
            "POST",
            "/captures/consent",
            content_type="application/json; charset=utf-8",
            body=b"{}",
        )[0]
        == 400
    )


def test_HTTP_1c_同意とアップロード済みの更新が一覧に出る(store: CaptureStore) -> None:
    api = api_for(store)
    assert post(api, "/captures/consent", {"consent": True, "ids": [ID1, ID2]})[2] == {"updated": 2}
    assert post(api, "/captures/uploaded", {"ids": [ID1, ID3]})[2] == {"updated": 1}  # 3 は同意なし
    data = jbody(call(api, "GET", "/captures?pending=1")[2])
    assert [i["capture"]["id"] for i in data["items"]] == [ID3, ID2]
    assert data["total"] == 2
    # 「提供しない」は消す
    assert post(api, "/captures/consent", {"consent": False, "ids": [ID2, ID3]})[2] == {
        "updated": 2
    }
    assert jbody(call(api, "GET", "/captures?pending=1")[2])["items"] == []
    assert call(api, "GET", f"/captures/{ID2}/image")[0] == 404


def test_HTTP_1d_許可リストのオリジンにだけCORSヘッダを返す_Origin無しは通す(
    store: CaptureStore,
) -> None:
    api = api_for(store, origins=(PWA,))
    status, headers, _ = call(api, "GET", "/captures", origin=PWA)
    assert status == 200
    assert headers["access-control-allow-origin"] == PWA
    assert "origin" in headers["vary"].lower()
    status, headers, _ = call(api, "GET", "/captures")  # Origin 無し（ブラウザ以外）
    assert status == 200
    assert "access-control-allow-origin" not in headers
    # 許可リストに無い Origin: GET は返すが CORS ヘッダを付けない（ブラウザは読めない）
    status, headers, _ = call(
        api, "GET", "/captures", origin="https://evil.example", host="192.168.4.1:8767"
    )
    assert status == 200
    assert "access-control-allow-origin" not in headers


def test_AUTH_7_許可リストが空ならCORSヘッダを付けない(store: CaptureStore) -> None:
    api = api_for(store, origins=())
    _, headers, _ = call(api, "GET", "/captures", origin="https://evil.example", host="192.168.4.1")
    assert not [k for k in headers if k.startswith("access-control")]


def test_AUTH_8_許可されないOriginのPOSTは403_JSON以外は415(store: CaptureStore) -> None:
    api = api_for(store, origins=(PWA,))
    payload = {"consent": True, "ids": [ID1]}
    for origin in (
        "https://evil.example",
        "null",
        "http://ezoroad.local.evil.example",
        "http://192.168.4.2:5174",
    ):
        status, headers, _ = post(
            api, "/captures/consent", payload, origin=origin, host="192.168.4.1:8767"
        )
        assert status == 403, origin
        assert "access-control-allow-origin" not in headers
    assert jbody(call(api, "GET", "/captures")[2])["items"][2]["capture"]["consent"] is False
    # 単純リクエストで書けるフォームの型は 415
    for ctype in (
        "text/plain",
        "multipart/form-data; boundary=x",
        "application/x-www-form-urlencoded",
    ):
        status, _, _ = call(
            api, "POST", "/captures/consent", content_type=ctype, body=b"{}", origin=PWA
        )
        assert status == 415
    # 許可リストのオリジンは書ける
    status, headers, _ = post(api, "/captures/consent", payload, origin=PWA)
    assert status == 200
    assert headers["access-control-allow-origin"] == PWA


def test_HTTP_1i_許可リストが空でもHostと同じホスト名のオリジンは許す(store: CaptureStore) -> None:
    api = api_for(store, origins=())
    payload = {"consent": True, "ids": [ID1]}
    status, headers, _ = post(api, "/captures/consent", payload, origin="http://ezoroad.local:5174")
    assert status == 200
    assert headers["access-control-allow-origin"] == "http://ezoroad.local:5174"
    status, _, _ = post(
        api, "/captures/consent", payload, origin="http://localhost:5197", host="localhost:8767"
    )
    assert status == 200
    status, _, _ = post(
        api, "/captures/consent", payload, origin="http://192.168.4.1:5174", host="192.168.4.1:8767"
    )
    assert status == 200
    assert post(api, "/captures/consent", payload, origin="http://other.local:5174")[0] == 403
    assert post(api, "/captures/consent", payload, origin="null")[0] == 403


def test_HTTP_1j_preflightは許すOriginに204と許可ヘッダ_許さないOriginに403(
    store: CaptureStore,
) -> None:
    api = api_for(store, origins=(PWA,))
    status, headers, body = call(api, "OPTIONS", "/captures/consent", origin=PWA)
    assert (status, body) == (204, b"")
    assert headers["access-control-allow-origin"] == PWA
    assert headers["access-control-allow-methods"] == "GET, POST"
    assert headers["access-control-allow-headers"] == "Content-Type"
    assert headers["access-control-max-age"] == "600"
    assert headers["access-control-allow-private-network"] == "true"
    status, headers, _ = call(
        api, "OPTIONS", "/captures/consent", origin="https://evil.example", host="192.168.4.1"
    )
    assert status == 403
    assert "access-control-allow-origin" not in headers
    assert call(api, "OPTIONS", "/captures/consent")[0] == 204  # Origin 無し


def test_HTTP_1k_consent_falseは消した件数を返しpendingとlimitが効く(store: CaptureStore) -> None:
    api = api_for(store)
    assert post(api, "/captures/consent", {"consent": True, "ids": [ID1]})[2] == {"updated": 1}
    assert post(api, "/captures/uploaded", {"ids": [ID1]})[2] == {"updated": 1}
    pending = jbody(call(api, "GET", "/captures?pending=1&limit=1")[2])
    assert [i["capture"]["id"] for i in pending["items"]] == [ID3]
    assert pending["total"] == 2
    everything = jbody(call(api, "GET", "/captures")[2])
    assert everything["total"] == 3
    assert [i["uploaded"] for i in everything["items"]] == [False, False, True]
    assert post(api, "/captures/consent", {"consent": False, "ids": [ID1]})[2] == {"updated": 0}


@pytest.mark.parametrize(
    "host",
    [
        "evil.example",
        "evil.example:8767",
        "ezoroad.local.evil.example",
        "a.b",
        "",
        None,
        "[evil]",
        "x" * 300,
    ],
)
def test_AUTH_13_HostがIPリテラルとlocalhostとezoroad_local以外なら421(
    store: CaptureStore, host: str | None
) -> None:
    api = api_for(store, origins=(PWA,))
    for method, target in (
        ("GET", "/captures"),
        ("GET", f"/captures/{ID1}/image"),
        ("OPTIONS", "/captures"),
    ):
        status, headers, body = call(api, method, target, host=host)
        assert status == 421, (method, target)
        assert JPEG not in body
        assert "access-control-allow-origin" not in headers


@pytest.mark.parametrize(
    "host",
    [
        "localhost",
        "LOCALHOST:8767",
        "ezoroad.local",
        "EzoRoad.Local:8767",
        "192.168.4.1",
        "192.168.4.1:8767",
        "127.0.0.1:1",
        "[::1]:8767",
        "[fe80::1]",
    ],
)
def test_HTTP_1h_Hostが許される名前なら通る(store: CaptureStore, host: str) -> None:
    assert call(api_for(store), "GET", "/captures", host=host)[0] == 200


def test_HTTP_1f_未知のパスは404_メソッド違いは405_応答にパスや例外文が無い(
    tmp_path: Path, store: CaptureStore
) -> None:
    api = api_for(store)
    assert call(api, "GET", "/")[0] == 404
    assert call(api, "GET", "/captures/")[0] == 404
    assert call(api, "GET", "/captures/consent")[0] == 405
    status, headers, _ = call(api, "DELETE", "/captures")
    assert status == 405
    assert headers["allow"] == "GET, OPTIONS"
    assert call(api, "PUT", "/captures/consent")[0] == 405
    assert call(api, "POST", "/captures")[0] == 405
    texts = b"".join(call(api, "GET", p)[2] for p in ("/x", "/captures/zzz/image"))
    assert str(tmp_path).encode() not in texts
    assert b"Traceback" not in texts


def test_HTTP_1f_ストアが壊れても内部のエラー文を返さない(
    store: CaptureStore, tmp_path: Path
) -> None:
    class Broken(CaptureStore):
        def list(self, limit: int = 200, *, pending: bool = False):  # type: ignore[no-untyped-def]
            msg = f"secret path {tmp_path}"
            raise RuntimeError(msg)

    api = CaptureApi(Broken(tmp_path / "broken"), lambda: None, ())
    status, _, body = call(api, "GET", "/captures")
    assert status == 500
    assert str(tmp_path).encode() not in body
    assert b"secret" not in body


# --- ソケットで待ち受ける（HTTP-1g・AUTH-11・FAIL-7） ---


@pytest.fixture
def server(store: CaptureStore):  # type: ignore[no-untyped-def]
    config = CaptureServerConfig(host="127.0.0.1", port=0)
    srv = CaptureServer(api_for(store), config, max_connections=8, timeout=1.0)
    port = srv.start()
    yield srv, port
    srv.stop()


def test_HTTP_1g_実際にソケットで待ち受けて標準のクライアントで取れる(server) -> None:  # type: ignore[no-untyped-def]
    _, port = server
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
    conn.request("GET", "/captures?pending=1")
    response = conn.getresponse()
    assert response.status == 200
    assert len(json.loads(response.read())["items"]) == 3
    conn.close()
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
    conn.request("GET", f"/captures/{ID1}/image")
    response = conn.getresponse()
    assert (response.status, response.read()) == (200, JPEG)
    conn.close()
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
    conn.request(
        "POST",
        "/captures/consent",
        body=json.dumps({"consent": True, "ids": [ID1]}),
        headers={"Content-Type": "application/json"},
    )
    response = conn.getresponse()
    assert json.loads(response.read()) == {"updated": 1}
    assert response.getheader("Connection", "close").lower() == "close"
    conn.close()


def test_HTTP_1g_Hostが偽のソケット接続は421(server) -> None:  # type: ignore[no-untyped-def]
    _, port = server
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
    conn.request("GET", "/captures", headers={"Host": "evil.example"})
    assert conn.getresponse().status == 421
    conn.close()


def test_AUTH_11_同時接続の9つ目は503_遅い接続は打ち切られる(server) -> None:  # type: ignore[no-untyped-def]
    _, port = server
    held = []
    for _ in range(8):
        sock = socket.create_connection(("127.0.0.1", port), timeout=3)
        sock.sendall(b"GET /captures HTTP/1.0\r\nHost: 127.0.0.1\r\n")  # 空行を送らず握る
        held.append(sock)

    def status_now() -> int:
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
        try:
            conn.request("GET", "/captures")
            return conn.getresponse().status
        finally:
            conn.close()

    # サーバーの 8 つのスロットが埋まるまで少し待つ（負荷が高くても 503 になるまで確かめる）
    status = 0
    for _ in range(40):
        status = status_now()
        if status == 503:
            break
        threading.Event().wait(0.05)
    assert status == 503
    # 握ったままの接続は、こちらが閉じなくてもサーバーが timeout（1 秒）で切る
    held[0].settimeout(4)
    assert held[0].recv(1) == b""
    for _ in range(40):
        if status_now() == 200:
            break
        threading.Event().wait(0.1)
    else:
        pytest.fail("スロットが空いても受けられない")
    for sock in held:
        sock.close()


def test_AUTH_11_8KBを超える本文は読まずに413(server) -> None:  # type: ignore[no-untyped-def]
    _, port = server
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
    conn.putrequest("POST", "/captures/consent")
    conn.putheader("Content-Type", "application/json")
    conn.putheader("Content-Length", "100000")
    conn.endheaders()
    assert conn.getresponse().status == 413
    conn.close()


def test_FAIL_7_ポートが使用中ならCaptureServerError(store: CaptureStore) -> None:
    first = CaptureServer(
        api_for(store), CaptureServerConfig(host="127.0.0.1", port=0), timeout=1.0
    )
    port = first.start()
    try:
        second = CaptureServer(
            api_for(store), CaptureServerConfig(host="127.0.0.1", port=port), timeout=1.0
        )
        with pytest.raises(CaptureServerError):
            second.start()
    finally:
        first.stop()
    first.stop()  # 2 回呼んでも壊れない
