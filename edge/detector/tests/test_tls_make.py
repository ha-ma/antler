"""pwa-https R1: 車ごとの CA とサーバー証明書（scripts/make_tls.py）。

OS の openssl を実際に呼ぶ。macOS の LibreSSL（/usr/bin/openssl）と OpenSSL 3 の両方が
あれば両方で確かめる。
"""

from __future__ import annotations

import importlib.util
import shutil
import ssl
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "make_tls.py"
spec = importlib.util.spec_from_file_location("make_tls", SCRIPT)
mk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mk)


def _openssl_binaries() -> list[str]:
    found: list[str] = []
    for candidate in (shutil.which("openssl"), "/usr/bin/openssl"):
        if candidate and Path(candidate).exists() and candidate not in found:
            found.append(candidate)
    return found


OPENSSLS = _openssl_binaries()
pytestmark = pytest.mark.skipif(not OPENSSLS, reason="openssl が無い")


def ossl(
    openssl: str, *args: str, check: bool = True, cwd: Path | None = None
) -> subprocess.CompletedProcess[str]:
    """テストが組み立てた引数だけで openssl を呼ぶ。"""
    return subprocess.run(  # noqa: S603
        [openssl, *args], capture_output=True, text=True, check=check, cwd=cwd
    )


def text(openssl: str, cert: Path) -> str:
    return ossl(openssl, "x509", "-noout", "-text", "-in", str(cert)).stdout


def days(openssl: str, cert: Path) -> float:
    out = ossl(openssl, "x509", "-noout", "-startdate", "-enddate", "-in", str(cert))
    lines = out.stdout.splitlines()
    start = ssl.cert_time_to_seconds(lines[0].split("=", 1)[1])
    end = ssl.cert_time_to_seconds(lines[1].split("=", 1)[1])
    return (end - start) / 86400


def verify(openssl: str, ca: Path, cert: Path) -> subprocess.CompletedProcess[str]:
    return ossl(openssl, "verify", "-CAfile", str(ca), str(cert), check=False)


@pytest.fixture(scope="module", params=OPENSSLS)
def made(
    request: pytest.FixtureRequest, tmp_path_factory: pytest.TempPathFactory
) -> tuple[str, Path]:
    openssl = request.param
    out = tmp_path_factory.mktemp("tls") / "tls"
    rc = mk.main(
        ["--out", str(out), "--ip", "192.168.2.1", "--ip", "127.0.0.1", "--openssl", openssl]
    )
    assert rc == 0
    return openssl, out


def test_uc_1a_server_cert_verifies_against_ca(made: tuple[str, Path]) -> None:
    openssl, out = made
    for name in ("ca.key", "ca.crt", "server.key", "server.crt"):
        assert (out / name).is_file()
    result = verify(openssl, out / "ca.crt", out / "server.crt")
    assert result.returncode == 0, result.stderr
    # Python の ssl でも CA として読めて、サーバーの鍵と証明書が対になる
    ctx = ssl.create_default_context(cafile=str(out / "ca.crt"))
    assert ctx.cert_store_stats()["x509_ca"] == 1
    server = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    server.load_cert_chain(out / "server.crt", out / "server.key")


def test_uc_1b_ca_is_name_constrained(made: tuple[str, Path]) -> None:
    openssl, out = made
    body = text(openssl, out / "ca.crt")
    assert "CA:TRUE, pathlen:0" in body
    assert "Certificate Sign" in body
    assert "X509v3 Name Constraints: critical" in body
    for allowed in (
        "DNS:ezoroad.local",
        "IP:192.168.2.1/255.255.255.255",
        "IP:127.0.0.1/255.255.255.255",
    ):
        assert allowed in body
    # 私設の範囲全体・localhost は入れない（旅行者の端末に CA が残るため。spec-adversary #7）
    for broad in ("localhost", "IP:192.168.0.0", "IP:10.0.0.0", "IP:172.16.0.0", "IP:127.0.0.0"):
        assert broad not in body
    assert "EZO ROAD vehicle CA" in body


def test_uc_1c_server_cert_san_eku_and_validity(made: tuple[str, Path]) -> None:
    openssl, out = made
    body = text(openssl, out / "server.crt")
    for san in ("DNS:ezoroad.local", "IP Address:192.168.2.1", "IP Address:127.0.0.1"):
        assert san in body
    assert "localhost" not in body
    assert "TLS Web Server Authentication" in body
    assert "CA:FALSE" in body
    assert days(openssl, out / "server.crt") == pytest.approx(397, abs=0.01)
    assert days(openssl, out / "server.crt") <= 825  # Apple の私設 CA の上限
    assert days(openssl, out / "ca.crt") == pytest.approx(3650, abs=0.01)


def test_uc_1d_keys_are_private(made: tuple[str, Path]) -> None:
    _, out = made
    assert out.stat().st_mode & 0o777 == 0o700
    for name in ("ca.key", "server.key"):
        assert (out / name).stat().st_mode & 0o777 == 0o600
    assert not [
        p for p in out.iterdir() if p.name.startswith(".make_tls-")
    ]  # 一時ディレクトリが残らない


def test_uc_1e_second_run_keeps_ca_and_new_ca_rotates(tmp_path: Path) -> None:
    openssl = OPENSSLS[0]
    out = tmp_path / "tls"
    assert mk.main(["--out", str(out), "--ip", "192.168.2.1", "--openssl", openssl]) == 0
    ca1, server1 = (out / "ca.crt").read_bytes(), (out / "server.crt").read_bytes()
    assert mk.main(["--out", str(out), "--ip", "192.168.2.1", "--openssl", openssl]) == 0
    assert (out / "ca.crt").read_bytes() == ca1
    assert (out / "server.crt").read_bytes() != server1
    assert verify(openssl, out / "ca.crt", out / "server.crt").returncode == 0
    assert (
        mk.main(["--out", str(out), "--ip", "192.168.3.1", "--new-ca", "--openssl", openssl]) == 0
    )
    assert (out / "ca.crt").read_bytes() != ca1
    assert "IP Address:192.168.3.1" in text(openssl, out / "server.crt")
    assert verify(openssl, out / "ca.crt", out / "server.crt").returncode == 0


@pytest.mark.parametrize("openssl", OPENSSLS)
def test_uc_1e_second_run_with_relative_out(
    openssl: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """UC-1e: 手順書どおり相対パスの --out で 2 回目を打っても、CA を残して証明書を作り直す。"""
    monkeypatch.chdir(tmp_path)
    assert mk.main(["--out", "tls", "--ip", "192.168.2.1", "--openssl", openssl]) == 0
    ca1 = (tmp_path / "tls" / "ca.crt").read_bytes()
    assert mk.main(["--out", "tls", "--ip", "192.168.2.1", "--openssl", openssl]) == 0
    assert (tmp_path / "tls" / "ca.crt").read_bytes() == ca1
    assert (
        verify(openssl, tmp_path / "tls" / "ca.crt", tmp_path / "tls" / "server.crt").returncode
        == 0
    )


@pytest.mark.parametrize("openssl", OPENSSLS)
def test_uc_1e_ip_outside_ca_needs_new_ca(
    tmp_path: Path, openssl: str, capsys: pytest.CaptureFixture[str]
) -> None:
    out = tmp_path / "tls"
    assert mk.main(["--out", str(out), "--ip", "192.168.2.1", "--openssl", openssl]) == 0
    before = {p.name: p.read_bytes() for p in out.iterdir()}
    capsys.readouterr()
    assert mk.main(["--out", str(out), "--ip", "192.168.9.1", "--openssl", openssl]) == 2
    assert "--new-ca" in capsys.readouterr().err
    assert {p.name: p.read_bytes() for p in out.iterdir()} == before


@pytest.mark.parametrize(
    "bad",
    [
        "8.8.8.8",
        "203.0.113.5",
        "::1",
        "fe80::1",
        "ezoroad.local",
        "192.168.2",
        "",
        "192.168.2.1/24",
    ],
)
def test_uc_1f_auth_13_rejects_non_private_ip(tmp_path: Path, bad: str) -> None:
    out = tmp_path / "tls"
    assert mk.main(["--out", str(out), "--ip", bad, "--openssl", OPENSSLS[0]]) == 2
    assert not out.exists()


def test_uc_1f_requires_an_ip_and_openssl(tmp_path: Path) -> None:
    assert mk.main(["--out", str(tmp_path / "a")]) == 2
    missing = str(tmp_path / "no-openssl")
    assert mk.main(["--out", str(tmp_path / "b"), "--ip", "192.168.2.1", "--openssl", missing]) == 2
    assert not (tmp_path / "b" / "ca.key").exists()


def test_uc_1f_half_ca_is_refused(tmp_path: Path) -> None:
    out = tmp_path / "tls"
    assert mk.main(["--out", str(out), "--ip", "192.168.2.1", "--openssl", OPENSSLS[0]]) == 0
    (out / "ca.key").unlink()
    before = (out / "server.crt").read_bytes()
    assert mk.main(["--out", str(out), "--ip", "192.168.2.1", "--openssl", OPENSSLS[0]]) == 2
    assert (out / "server.crt").read_bytes() == before


def test_uc_1g_prints_fingerprint_and_url_but_no_key(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    out = tmp_path / "tls"
    assert mk.main(["--out", str(out), "--ip", "192.168.2.1", "--openssl", OPENSSLS[0]]) == 0
    printed = capsys.readouterr()
    assert mk.fingerprint(out / "ca.crt") in printed.out
    assert "http://192.168.2.1:8080/" in printed.out
    assert "PRIVATE KEY" not in printed.out + printed.err
    assert len(mk.fingerprint(out / "ca.crt").split(":")) == 32


def test_auth_12_leaked_ca_cannot_sign_public_names(made: tuple[str, Path], tmp_path: Path) -> None:
    """CA の鍵が漏れても、名前の制約から外れた証明書は検証で失敗する。"""
    openssl, out = made
    for san, cn in (
        ("DNS:example.com", "example.com"),
        ("IP:8.8.8.8", "8.8.8.8"),
        ("IP:192.168.99.1", "192.168.99.1"),
    ):
        ext = tmp_path / "bad.ext"
        ext.write_text(f"[v]\nbasicConstraints=CA:FALSE\nsubjectAltName={san}\n", encoding="utf-8")
        cnf = tmp_path / "bad.cnf"
        cnf.write_text(
            f"[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nCN={cn}\n", encoding="utf-8"
        )
        ossl(
            openssl, "req", "-new", "-newkey", "rsa:2048", "-nodes", "-config", str(cnf),
            "-keyout", "bad.key", "-out", "bad.csr", cwd=tmp_path,
        )  # fmt: skip
        ossl(
            openssl, "x509", "-req", "-in", "bad.csr", "-CA", str(out / "ca.crt"),
            "-CAkey", str(out / "ca.key"), "-set_serial", "7", "-days", "30",
            "-extfile", str(ext), "-extensions", "v", "-out", "bad.crt", cwd=tmp_path,
        )  # fmt: skip
        result = verify(openssl, out / "ca.crt", tmp_path / "bad.crt")
        assert result.returncode != 0, san
        assert "subtree" in (result.stdout + result.stderr).lower(), san
