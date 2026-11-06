"""pwa-https R2: `[tls]`・`[pwa_server]` の設定と、SSLContext を作る tls.server_context。"""

from __future__ import annotations

import shutil
import ssl
from pathlib import Path

import pytest

from detector.config import Config, ConfigError, PwaServerConfig, TlsConfig, load_config
from detector.tls import TlsError, server_context

from .conftest import named


def write(tmp_path: Path, text: str) -> Path:
    p = tmp_path / "detector.toml"
    p.write_text(text, encoding="utf-8")
    return p


def tls_config(tmp_path: Path, tls: Path, **over: str) -> Config:
    """tmp_path/detector.toml から見た相対パスで [tls] を書く。"""
    rel = Path("..") / tls.parent.name / tls.name if tls.parent != tmp_path else Path(tls.name)
    keys = {
        "cert": str(rel / "server.crt"),
        "key": str(rel / "server.key"),
        "ca_cert": str(rel / "ca.crt"),
    }
    keys.update(over)
    body = "".join(f'{k} = "{v}"\n' for k, v in keys.items())
    return load_config(write(tmp_path, "[tls]\n" + body))


def copy_tls(src: Path, dst: Path) -> Path:
    shutil.copytree(src, dst)
    return dst


def test_uc_2a_no_tls_section_means_no_context(tmp_path: Path, logbuf) -> None:
    config = load_config(write(tmp_path, ""))
    assert config.tls == TlsConfig()
    assert server_context(config) is None
    assert server_context(load_config(write(tmp_path, '[tls]\ncert = ""\nkey = ""\n'))) is None


def test_uc_2b_cert_and_key_make_a_server_context(tmp_path: Path, tls_dir: Path) -> None:
    tls = copy_tls(tls_dir, tmp_path / "tls")
    context = server_context(tls_config(tmp_path, tls))
    assert isinstance(context, ssl.SSLContext)
    assert context.minimum_version >= ssl.TLSVersion.TLSv1_2
    assert context.protocol == ssl.PROTOCOL_TLS_SERVER


@pytest.mark.parametrize(
    "text",
    ['[tls]\ncert = "a.crt"\n', '[tls]\nkey = "a.key"\n', '[tls]\ncert = "a.crt"\nkey = " "\n'],
)
def test_uc_2c_fail_1_half_tls_is_config_error(tmp_path: Path, text: str) -> None:
    with pytest.raises(ConfigError, match=r"tls\.cert と tls\.key"):
        load_config(write(tmp_path, text))


def test_uc_2d_fail_2_auth_14_missing_or_mismatched_files_raise(
    tmp_path: Path, tls_dir: Path, other_tls_dir: Path, logbuf
) -> None:
    """UC-2d / FAIL-2 / AUTH-14: 無い・合わない証明書は TlsError（平文の context を返さない）。"""
    tls = copy_tls(tls_dir, tmp_path / "tls")
    with pytest.raises(TlsError) as missing:
        server_context(tls_config(tmp_path, tls, cert="tls/nope.crt"))
    # 鍵と証明書が対でない（別の CA の鍵）
    shutil.copy(other_tls_dir / "server.key", tls / "other.key")
    (tls / "other.key").chmod(0o600)
    with pytest.raises(TlsError) as mismatch:
        server_context(tls_config(tmp_path, tls, key="tls/other.key"))
    # PEM が壊れている
    (tls / "broken.crt").write_text("-----BEGIN CERTIFICATE-----\nnope\n", encoding="ascii")
    with pytest.raises(TlsError) as broken:
        server_context(tls_config(tmp_path, tls, cert="tls/broken.crt"))
    for err in (missing, mismatch, broken):
        text = str(err.value)
        assert str(tmp_path) not in text
        assert "PRIVATE KEY" not in text
    reasons = [e["reason"] for e in named(logbuf, "tls.failed")]
    assert reasons == ["missing", "invalid", "invalid"]
    assert str(tmp_path) not in logbuf.getvalue()


def test_uc_2e_fail_3_loose_key_permissions_warn_but_start(
    tmp_path: Path, tls_dir: Path, logbuf
) -> None:
    tls = copy_tls(tls_dir, tmp_path / "tls")
    (tls / "server.key").chmod(0o644)
    assert server_context(tls_config(tmp_path, tls)) is not None
    assert len(named(logbuf, "tls.key_permissions")) == 1


def test_uc_2f_pwa_server_defaults_and_ranges(tmp_path: Path) -> None:
    config = load_config(write(tmp_path, ""))
    assert config.pwa_server == PwaServerConfig()
    assert (config.pwa_server.host, config.pwa_server.https_port, config.pwa_server.http_port) == (
        "127.0.0.1",
        8443,
        8080,
    )
    assert config.pwa_server.dist == "../../apps/pwa/dist"
    for bad, key in (
        ("https_port = 0", "https_port"),
        ("http_port = 70000", "http_port"),
        ('host = ""', "host"),
        ('dist = " "', "dist"),
        ("https_port = 9000\nhttp_port = 9000", "https_port"),
        ("nope = 1", "nope"),
    ):
        with pytest.raises(ConfigError, match=key):
            load_config(write(tmp_path, f"[pwa_server]\n{bad}\n"))


def test_uc_2g_ca_cert_alone_is_config_error(tmp_path: Path) -> None:
    with pytest.raises(ConfigError, match="ca_cert"):
        load_config(write(tmp_path, '[tls]\nca_cert = "tls/ca.crt"\n'))


def test_uc_2h_disabled_tls_warns(tmp_path: Path, logbuf) -> None:
    assert server_context(load_config(write(tmp_path, ""))) is None
    assert len(named(logbuf, "tls.disabled")) == 1
