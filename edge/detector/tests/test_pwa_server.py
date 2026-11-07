"""pwa-https R4: PWA の静的配信（https）と CA の配布（http）。detector.pwa_server。"""

from __future__ import annotations

import http.client
import os
import shutil
import socket
import ssl
import threading
import time
from pathlib import Path

import pytest

from detector.config import PwaServerConfig, load_config
from detector.pwa_server import (
    CA_PATH,
    PwaServer,
    PwaServerError,
    build,
    host_allowed,
    load_dist,
    main,
    route_http,
    route_https,
    self_check,
    setup_page,
)

from .conftest import named, ssl_client, ssl_server

INDEX = (
    b'<!doctype html><html><head><meta http-equiv="Content-Security-Policy" '
    b"content=\"connect-src 'self' wss://ezoroad.local:8765 wss://127.0.0.1:8765\"></head>"
    b'<body><div id="root"></div></body></html>'
)
JS = b"console.log('pwa')"
H = {"Host": "127.0.0.1:8443"}


@pytest.fixture
def dist(tmp_path: Path) -> Path:
    root = tmp_path / "dist"
    (root / "assets").mkdir(parents=True)
    (root / "index.html").write_bytes(INDEX)
    (root / "assets" / "index-abc123.js").write_bytes(JS)
    (root / "assets" / "app.css").write_text("body{}", encoding="utf-8")
    (root / "zones.geojson").write_text("{}", encoding="utf-8")
    (root / "fonts").mkdir()
    (root / "fonts" / "noto.woff2").write_bytes(b"wOF2")
    (root / ".DS_Store").write_bytes(b"secret")
    (root / "server.key").write_bytes(b"-----BEGIN PRIVATE KEY-----")
    (root / "assets" / "bundle.PEM").write_bytes(b"-----BEGIN PRIVATE KEY-----")
    (root / ".hidden").mkdir()
    (root / ".hidden" / "x.js").write_bytes(b"secret")
    secret = tmp_path / "outside.txt"
    secret.write_text("outside-secret", encoding="utf-8")
    (root / "link.txt").symlink_to(secret)
    (root / "linkdir").symlink_to(tmp_path)
    return root


@pytest.fixture
def assets(dist: Path):
    return load_dist(dist)


def get(assets, target: str, method: str = "GET", headers=None):
    return route_https(method, target, headers or H, assets)


def test_uc_4a_serves_dist_files_with_content_types(assets) -> None:
    r = get(assets, "/")
    assert (r.status, r.body) == (200, INDEX)
    assert r.headers["Content-Type"] == "text/html; charset=utf-8"
    r = get(assets, "/assets/index-abc123.js")
    assert (r.status, r.body, r.headers["Content-Type"]) == (
        200,
        JS,
        "text/javascript; charset=utf-8",
    )
    assert get(assets, "/assets/app.css").headers["Content-Type"] == "text/css; charset=utf-8"
    assert get(assets, "/zones.geojson").headers["Content-Type"] == "application/geo+json"
    assert get(assets, "/fonts/noto.woff2").headers["Content-Type"] == "font/woff2"
    assert get(assets, "/assets/index-abc123.js?v=1").body == JS  # クエリは無視


def test_uc_4b_spa_fallback_only_for_paths_without_extension(assets) -> None:
    for path in ("/drive", "/b/1", "/x/y/z"):
        assert get(assets, path).body == INDEX
    for path in ("/nope.js", "/assets/missing.css", "/favicon.ico"):
        assert get(assets, path).status == 404


@pytest.mark.parametrize(
    "target",
    [
        "/../outside.txt",
        "/assets/../../outside.txt",
        "/%2e%2e/outside.txt",
        "/%2E%2E%2Foutside.txt",
        "//etc/passwd",
        "/..\\outside.txt",
        "/link.txt",
        "/linkdir/outside.txt",
        "/.DS_Store",
        "/.hidden/x.js",
        "/server.key",
        "/assets/bundle.PEM",
        "http://evil.example/../outside.txt",
    ],
)
def test_uc_4c_auth_1_no_traversal_symlink_or_dotfile(assets, target: str) -> None:
    r = get(assets, target)
    assert r.status in (200, 404)
    assert b"outside-secret" not in r.body
    assert b"secret" not in r.body
    assert b"PRIVATE KEY" not in r.body
    if r.status == 200:
        assert r.body == INDEX  # 拡張子の無いパスの SPA だけ


def test_uc_4c_symlinks_and_dotfiles_are_not_loaded(assets) -> None:
    assert sorted(assets) == [
        "/assets/app.css",
        "/assets/index-abc123.js",
        "/fonts/noto.woff2",
        "/index.html",
        "/zones.geojson",
    ]


def test_uc_4d_cache_and_security_headers(assets) -> None:
    index = get(assets, "/")
    hashed = get(assets, "/assets/index-abc123.js")
    other = get(assets, "/zones.geojson")
    assert index.headers["Cache-Control"] == "no-cache"
    assert hashed.headers["Cache-Control"] == "public, max-age=31536000, immutable"
    assert other.headers["Cache-Control"] == "no-cache"
    for r in (index, hashed, other, get(assets, "/healthz"), get(assets, "/nope.js")):
        assert r.headers["X-Content-Type-Options"] == "nosniff"
        assert r.headers["Referrer-Policy"] == "no-referrer"
        assert r.headers["X-Frame-Options"] == "DENY"  # 同意の操作を枠に入れさせない
        assert "Strict-Transport-Security" not in r.headers
    for r in (index, hashed, other):
        assert r.headers["Content-Security-Policy"] == "frame-ancestors 'none'"


@pytest.mark.parametrize("method", ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
def test_uc_4e_auth_6_https_only_get_and_head(assets, method: str) -> None:
    r = get(assets, "/", method)
    assert r.status == 405
    assert r.headers["Allow"] == "GET, HEAD"


@pytest.mark.parametrize(
    "host",
    [
        None,
        "",
        "evil.example",
        "ezoroad.local.evil.example",
        "[::1]:8443",
        "::1",
        "[fe80::1%25<svg/onload=alert(1)>]",
        "fe80::1%<b>x</b>",
        "<script>alert(1)</script>",
        "192.168.2.1.nip.io",
        "a" * 300,
    ],
)
def test_uc_4f_auth_3_auth_9_host_must_be_ipv4_or_known_names(assets, host) -> None:
    headers = {} if host is None else {"Host": host}
    https = route_https("GET", "/", headers, assets)
    page = setup_page("AA:BB", 8443)
    plain = route_http("GET", "/", headers, page, b"CA")
    assert (https.status, plain.status) == (421, 421)
    assert https.body == plain.body == b""


@pytest.mark.parametrize(
    "host", ["192.168.2.1", "192.168.2.1:8443", "ezoroad.local", "LOCALHOST:8080"]
)
def test_uc_4f_allowed_hosts(host: str) -> None:
    assert host_allowed(host)


def test_uc_4g_healthz_is_204(assets) -> None:
    r = get(assets, "/healthz")
    assert (r.status, r.body) == (204, b"")


def test_uc_4g_fail_10_setup_page_probes_with_no_cors_every_3s_after_previous() -> None:
    body, csp = setup_page("AA:BB", 8443)
    html = body.decode()
    assert "mode:'no-cors'" in html
    assert "cache:'no-store'" in html
    assert "setTimeout(check,3000)" in html  # 失敗のあとに次を予約する（重ならない）
    assert "location.hostname" in html
    assert ":8443/" in html
    assert "script-src 'sha256-" in csp
    assert "unsafe-inline" not in csp


def test_uc_4h_auth_10_setup_page_has_four_languages_and_no_host() -> None:
    page = setup_page("12:34:AB", 8443)
    r = route_http("GET", "/", {"Host": "192.168.77.5:8080"}, page, b"CA")
    html = r.body.decode()
    assert r.status == 200
    assert r.headers["Content-Type"] == "text/html; charset=utf-8"
    assert r.headers["Content-Security-Policy"] == page[1]
    for lang in ("ja", "en", "zh", "ko"):
        assert f'<section lang="{lang}">' in html
    assert html.count("12:34:AB") == 4
    assert html.count(f'href="{CA_PATH}"') == 4
    for text in ("プロファイルを削除", "Remove Profile", "移除描述檔", "프로파일 제거"):
        assert text in html  # 返却したら消す手順
    assert "192.168.77.5" not in html  # Host の値をページに入れない


def test_brand_10_setup_page_names_shikashi_navigator_and_keeps_ca_name() -> None:
    """BRAND-10（rebrand-shikashi）: 名前は SHIKASHI NAVIGATOR。

    手順の「EZO ROAD」は CA の名前（make_tls.py の O = EZO ROAD）なので残す。
    """
    html = setup_page("AA", 8443)[0].decode()
    assert "<title>SHIKASHI NAVIGATOR setup</title>" in html
    for heading in ("最初に 1 回だけ", "one-time setup", "只需設定一次", "처음 한 번만"):
        assert f"<h2>SHIKASHI NAVIGATOR — {heading}</h2>" in html
    for button in (
        "SHIKASHI NAVIGATOR を開く",
        "Open SHIKASHI NAVIGATOR",
        "開啟 SHIKASHI NAVIGATOR",
        "SHIKASHI NAVIGATOR 열기",
    ):
        assert f'<a class="button open" href="#">{button}</a>' in html
    for step in (
        "EZO ROAD（証明書の名前）",
        "EZO ROAD (the certificate name)",
        "EZO ROAD（憑證名稱）",
        "EZO ROAD(인증서 이름)",
    ):
        assert step in html
    assert "EZO ROAD を開く" not in html
    assert "<h2>EZO ROAD" not in html


def test_uc_4i_auth_4_auth_5_ca_download_and_no_keys(tls_dir: Path, assets) -> None:
    pem = (tls_dir / "ca.crt").read_bytes()
    page = setup_page("AA", 8443)
    r = route_http("GET", CA_PATH, {"Host": "192.168.2.1:8080"}, page, pem)
    assert (r.status, r.body) == (200, pem)
    assert r.headers["Content-Type"] == "application/x-x509-ca-cert"
    for path in ("/ca.key", "/server.key", "/tls/ca.key", "/tls/server.key", "/ezoroad-ca.key"):
        plain = route_http("GET", path, {"Host": "192.168.2.1:8080"}, page, pem)
        assert plain.status == 404
        assert b"PRIVATE KEY" not in plain.body
    for path in ("/", "/ca.key", "/server.key", "/x", "/assets/index-abc123.js"):
        assert b"PRIVATE KEY" not in get(assets, path).body


def test_uc_4j_auth_7_http_other_paths_404_and_methods_405() -> None:
    """UC-4j / AUTH-7: http のほかのパスは 404、GET・HEAD 以外は 405。"""
    page = setup_page("AA", 8443)
    h = {"Host": "ezoroad.local:8080"}
    for path in ("/index.html", "/healthz", "/assets/x.js", "/drive"):
        assert route_http("GET", path, h, page, b"CA").status == 404
    for method in ("POST", "PUT", "DELETE"):
        assert route_http(method, "/", h, page, b"CA").status == 405


def write_config(tmp_path: Path, tls: Path, dist: Path, extra: str = "", **tls_over: str) -> Path:
    keys = {
        "cert": str(tls / "server.crt"),
        "key": str(tls / "server.key"),
        "ca_cert": str(tls / "ca.crt"),
    }
    keys.update(tls_over)
    body = "[tls]\n" + "".join(f'{k} = "{v}"\n' for k, v in keys.items())
    body += (
        f'[pwa_server]\ndist = "{dist}"\nhttps_port = {free_port()}\nhttp_port = {free_port()}\n'
    )
    path = tmp_path / "detector.toml"
    path.write_text(body + extra, encoding="utf-8")
    return path


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def test_uc_4k_fail_8_auth_15_refuses_to_start_without_tls_or_dist(
    tmp_path: Path, tls_dir: Path, dist: Path
) -> None:
    """UC-4k / FAIL-8 / AUTH-15: TLS・index.html・ca_cert がそろわなければ起動しない。"""
    empty = tmp_path / "empty.toml"
    empty.write_text(f'[pwa_server]\ndist = "{dist}"\n', encoding="utf-8")
    assert main(["--config", str(empty)]) == 2
    with pytest.raises(PwaServerError, match="ca_cert"):
        build(load_config(empty))
    no_index = tmp_path / "noindex"
    no_index.mkdir()
    with pytest.raises(PwaServerError, match=r"index\.html"):
        build(load_config(write_config(tmp_path, tls_dir, no_index)))
    with pytest.raises(PwaServerError, match="dist"):
        build(load_config(write_config(tmp_path, tls_dir, tmp_path / "missing")))
    with pytest.raises(PwaServerError, match="MB"):
        load_dist(dist, limit=10)
    # ca_cert に鍵を指した
    with pytest.raises(PwaServerError, match="ca_cert"):
        build(load_config(write_config(tmp_path, tls_dir, dist, ca_cert=str(tls_dir / "ca.key"))))


def https(port: int, tls: Path, path: str = "/", host: str | None = None) -> tuple[int, bytes]:
    conn = http.client.HTTPSConnection("127.0.0.1", port, timeout=3, context=ssl_client(tls))
    try:
        conn.request("GET", path, headers={"Host": host} if host else {})
        response = conn.getresponse()
        return response.status, response.read()
    finally:
        conn.close()


def plain(
    port: int, path: str = "/", method: str = "GET", host: str | None = None
) -> tuple[int, bytes]:
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
    try:
        conn.request(method, path, headers={"Host": host} if host else {})
        response = conn.getresponse()
        return response.status, response.read()
    finally:
        conn.close()


@pytest.fixture
def running(tmp_path: Path, tls_dir: Path, dist: Path):
    server = build(load_config(write_config(tmp_path, tls_dir, dist)))
    ports = server.start()
    yield server, ports
    server.stop()


def test_uc_4_sockets_serve_https_and_http(running, tls_dir: Path, logbuf) -> None:
    _, (https_port, http_port) = running
    assert https(https_port, tls_dir) == (200, INDEX)
    assert https(https_port, tls_dir, "/healthz")[0] == 204
    assert https(https_port, tls_dir, "/", host="evil.example")[0] == 421
    status, body = plain(http_port)
    assert status == 200
    assert b'<section lang="ko">' in body
    assert plain(http_port, CA_PATH)[1] == (tls_dir / "ca.crt").read_bytes()
    assert plain(http_port, "/", "PUT")[0] == 405
    # https の口に平文で話しかけても落ちない
    with pytest.raises((http.client.HTTPException, OSError)):
        plain(https_port)
    assert https(https_port, tls_dir)[0] == 200


def raw_https(port: int, tls: Path, request: bytes) -> bytes:
    with (
        socket.create_connection(("127.0.0.1", port), timeout=3) as sock,
        ssl_client(tls).wrap_socket(sock, server_hostname="127.0.0.1") as tls_sock,
    ):
        tls_sock.sendall(request)
        chunks = []
        while chunk := tls_sock.recv(65536):
            chunks.append(chunk)
        return b"".join(chunks)


def test_auth_3_lowercase_host_and_unknown_methods_over_socket(running, tls_dir: Path) -> None:
    """AUTH-3 / UC-4b: 見出しの綴り（`host:`）を問わず、知らないメソッドも route を通って 405。"""
    _, (https_port, _) = running
    ok = raw_https(https_port, tls_dir, b"GET / HTTP/1.0\r\nhost: 127.0.0.1:8443\r\n\r\n")
    assert ok.startswith(b"HTTP/1.0 200")
    bad = raw_https(https_port, tls_dir, b"GET / HTTP/1.0\r\nhost: evil.example\r\n\r\n")
    assert bad.startswith(b"HTTP/1.0 421")
    for method in (b"TRACE", b"CONNECT", b"FOO"):
        r = raw_https(https_port, tls_dir, method + b" / HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n")
        assert r.startswith(b"HTTP/1.0 405"), r[:40]
        assert b"X-Content-Type-Options: nosniff" in r


def test_uc_4_request_errors_do_not_print_client_address(
    running, capsys: pytest.CaptureFixture[str], logbuf
) -> None:
    """R4: 途中で切れた接続のエラーで、接続元のアドレスとトレースバックを stderr に出さない。"""
    server, _ = running
    for httpd in server._servers:
        try:
            raise ConnectionResetError
        except ConnectionResetError:
            httpd.handle_error(None, ("192.168.2.77", 50000))
    captured = capsys.readouterr()
    assert "192.168.2.77" not in captured.err + captured.out
    assert named(logbuf, "pwa_server.request_failed")[0]["error_type"] == "ConnectionResetError"


def test_fail_8_unreadable_dist_file_is_exit_2(dist: Path) -> None:
    """FAIL-8: dist の中の読めないファイルは PwaServerError（main は終了コード 2）。"""
    locked = dist / "assets" / "locked.js"
    locked.write_bytes(b"x")
    locked.chmod(0)
    try:
        if os.access(locked, os.R_OK):
            pytest.skip("root では権限で読めなくできない")
        with pytest.raises(PwaServerError, match="読めない"):
            load_dist(dist)
    finally:
        locked.chmod(0o644)


def test_auth_2_raw_traversal_over_socket(running, tls_dir: Path) -> None:
    _, (https_port, _) = running
    raw = socket.create_connection(("127.0.0.1", https_port), timeout=3)
    wrapped = ssl_client(tls_dir).wrap_socket(raw, server_hostname="127.0.0.1")
    wrapped.sendall(b"GET /../../../../etc/passwd HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n")
    data = b""
    while chunk := wrapped.recv(65536):
        data += chunk
    wrapped.close()
    assert b"root:" not in data
    assert data.endswith(INDEX) or b" 404 " in data.split(b"\r\n", 1)[0]


def test_uc_4l_auth_8_fail_9_slots_are_counted_before_threads(
    tmp_path: Path, tls_dir: Path, dist: Path
) -> None:
    """UC-4l / AUTH-8 / FAIL-9: 上限を超えた接続はスレッドを作らずに閉じる。

    黙った接続は 5 秒で閉じる。
    """
    config = load_config(write_config(tmp_path, tls_dir, dist))
    built = build(config)
    server = PwaServer(
        config.pwa_server,
        built._assets,
        built._ca_pem,
        built._fingerprint,
        ssl_server(tls_dir),
        timeout=1.0,
        max_connections=2,
    )
    https_port, _ = server.start()
    try:
        before = threading.active_count()
        held = [socket.create_connection(("127.0.0.1", https_port), timeout=3) for _ in range(2)]
        time.sleep(0.3)
        flood = [socket.create_connection(("127.0.0.1", https_port), timeout=3) for _ in range(10)]
        time.sleep(0.3)
        assert threading.active_count() <= before + 2  # 溢れた 10 本はスレッドにならない
        for sock in flood:
            sock.settimeout(2)
            assert sock.recv(1) == b""  # 握手もせずに閉じられる
            sock.close()
        for sock in held:  # 握手をしない接続は 1 秒で閉じる
            sock.settimeout(3)
            started = time.monotonic()
            assert sock.recv(1) == b""
            assert time.monotonic() - started < 2.5
            sock.close()
        for _ in range(40):
            try:
                if https(https_port, tls_dir)[0] == 200:
                    break
            except (ssl.SSLError, OSError):
                time.sleep(0.1)
        else:
            pytest.fail("枠が空いても受けられない")
    finally:
        server.stop()


def test_uc_4m_self_check(tmp_path: Path, tls_dir: Path, logbuf) -> None:
    """UC-4m: 起動時の自己検査（SAN の IP・CSP・残りの日数）。"""
    cert = tls_dir / "server.crt"
    self_check(cert, "127.0.0.1", INDEX)
    self_check(cert, "0.0.0.0", INDEX)  # noqa: S104  全インターフェースは SAN と比べない
    self_check(cert, "ezoroad.local", INDEX)
    assert not named(logbuf, "pwa_server.csp_missing_host")
    with pytest.raises(PwaServerError, match="証明書に無い"):
        self_check(cert, "192.168.50.1", INDEX)
    self_check(cert, "127.0.0.1", b"<html>no csp</html>")
    assert named(logbuf, "pwa_server.csp_missing_host")[0]["host"] == "127.0.0.1"
    soon = time.time() + 397 * 86400 - 10 * 86400
    self_check(cert, "127.0.0.1", INDEX, now=soon)
    assert named(logbuf, "pwa_server.cert_expiring")
    with pytest.raises(PwaServerError, match="期限"):
        self_check(cert, "127.0.0.1", INDEX, now=time.time() + 400 * 86400)


def test_uc_4m_expired_certificate_refuses_to_start(
    tmp_path: Path, tls_dir: Path, dist: Path
) -> None:
    config = load_config(write_config(tmp_path, tls_dir, dist))
    with pytest.raises(PwaServerError, match="期限"):
        build(config, now=time.time() + 400 * 86400)


def test_fail_7_port_in_use_closes_both(tmp_path: Path, tls_dir: Path, dist: Path) -> None:
    with socket.socket() as busy:
        busy.bind(("127.0.0.1", 0))
        busy.listen()
        port = busy.getsockname()[1]
        path = write_config(tmp_path, tls_dir, dist)
        text = path.read_text(encoding="utf-8")
        head, _ = text.split("http_port = ")
        path.write_text(head + f"http_port = {port}\n", encoding="utf-8")
        server = build(load_config(path))
        with pytest.raises(PwaServerError):
            server.start()
        server.stop()  # 2 回目も壊れない
        https_port = load_config(path).pwa_server.https_port
        with socket.socket() as again:
            again.bind(("127.0.0.1", https_port))  # https の口も閉じている


def test_main_runs_until_stopped(tmp_path: Path, tls_dir: Path, dist: Path) -> None:
    path = write_config(tmp_path, tls_dir, dist)
    stop = threading.Event()
    codes: list[int] = []
    thread = threading.Thread(target=lambda: codes.append(main(["--config", str(path)], stop=stop)))
    thread.start()
    https_port = load_config(path).pwa_server.https_port
    for _ in range(50):
        try:
            if https(https_port, tls_dir)[0] == 200:
                break
        except OSError:
            time.sleep(0.05)
    stop.set()
    thread.join(5)
    assert codes == [0]


def test_config_copy_with_relative_paths(tmp_path: Path, tls_dir: Path, dist: Path) -> None:
    shutil.copytree(tls_dir, tmp_path / "tls")
    path = tmp_path / "detector.toml"
    path.write_text(
        '[tls]\ncert = "tls/server.crt"\nkey = "tls/server.key"\nca_cert = "tls/ca.crt"\n'
        f'[pwa_server]\ndist = "dist"\nhttps_port = {free_port()}\nhttp_port = {free_port()}\n',
        encoding="utf-8",
    )
    server = build(load_config(path))
    assert isinstance(server, PwaServer)
    assert PwaServerConfig().dist == "../../apps/pwa/dist"
