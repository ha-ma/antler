"""車ごとの CA とサーバー証明書を作る（docs/specs/pwa-https R1）。

    python edge/detector/scripts/make_tls.py --out edge/detector/tls --ip 192.168.2.1

- CA は名前の制約つき（`ezoroad.local` と `--ip` の各 IP の /32 だけ）。CA の鍵が漏れても、
  公開のサイトや利用者の家の私設 IP は名乗れない（返却後も旅行者の端末に CA が残るため）
- サーバー証明書の SAN は `ezoroad.local` と `--ip` の各 IP。EKU は serverAuth、397 日
- すでに CA があれば CA は作り直さず、サーバー証明書だけ発行し直す（スマホに入れ直さなくてよい）。
  CA を作り直すのは `--new-ca` のときだけ。CA の制約に無い IP を足すときも `--new-ca` が要る
- 鍵は 0600、ディレクトリは 0700。途中で失敗したら既存のファイルは変えない
- 依存を増やさず OS の `openssl`（macOS の LibreSSL でも OpenSSL 3 でも）を呼ぶ

終了コード: 0 = 作った、2 = 引数・openssl・既存のファイルの問題（何も変えていない）。
"""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import os
import secrets
import shutil
import ssl
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Sequence

HOSTS = ("ezoroad.local",)
PRIVATE_NETS = tuple(
    ipaddress.IPv4Network(n)
    for n in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8")
)
CA_DAYS = 3650
SERVER_DAYS = 397  # Apple の私設 CA の上限 825 日の内側。公開の上限（398 日）にもそろえる
SETUP_PORT = 8080
OPENSSL_TIMEOUT_S = 30


class MakeTlsError(Exception):
    """作れない（引数・openssl・既存のファイル）。何も変えていない。"""


def parse_ips(values: Sequence[str]) -> list[ipaddress.IPv4Address]:
    """`--ip` を私設の IPv4 だけに限る（名前の制約から外れた証明書を作らない）。"""
    if not values:
        msg = "--ip を 1 つ以上（AP の IP。例: 192.168.2.1）"
        raise MakeTlsError(msg)
    ips: list[ipaddress.IPv4Address] = []
    for value in values:
        try:
            ip = ipaddress.IPv4Address(value.strip())
        except ValueError as exc:
            msg = f"--ip は IPv4 の形にする: {value!r}"
            raise MakeTlsError(msg) from exc
        if not any(ip in net for net in PRIVATE_NETS):
            msg = f"--ip は私設の範囲（10/8・172.16/12・192.168/16・127/8）だけ: {value}"
            raise MakeTlsError(msg)
        if ip not in ips:
            ips.append(ip)
    return ips


def _name_constraints(ips: Sequence[ipaddress.IPv4Address]) -> str:
    """この車の名前と IP（/32）だけ。openssl の設定では IP の範囲をマスクで書く（LibreSSL も）。"""
    dns = [f"permitted;DNS:{h}" for h in HOSTS]
    hosts = [f"permitted;IP:{ip}/255.255.255.255" for ip in ips]
    return "critical," + ",".join(dns + hosts)


def ca_config(tag: str, ips: Sequence[ipaddress.IPv4Address]) -> str:
    return "\n".join(
        [
            "[req]",
            "distinguished_name = dn",
            "prompt = no",
            "x509_extensions = v3_ca",
            "[dn]",
            "O = EZO ROAD",
            f"CN = EZO ROAD vehicle CA {tag}",
            "[v3_ca]",
            "basicConstraints = critical,CA:TRUE,pathlen:0",
            "keyUsage = critical,keyCertSign,cRLSign",
            "subjectKeyIdentifier = hash",
            f"nameConstraints = {_name_constraints(ips)}",
            "",
        ]
    )


def server_request_config() -> str:
    return "\n".join(
        [
            "[req]",
            "distinguished_name = dn",
            "prompt = no",
            "[dn]",
            "O = EZO ROAD",
            "CN = ezoroad.local",
            "",
        ]
    )


def server_extensions(ips: Sequence[ipaddress.IPv4Address]) -> str:
    san = ",".join([f"DNS:{h}" for h in HOSTS] + [f"IP:{ip}" for ip in ips])
    return "\n".join(
        [
            "[v3_srv]",
            "basicConstraints = critical,CA:FALSE",
            "keyUsage = critical,digitalSignature,keyEncipherment",
            "extendedKeyUsage = serverAuth",
            f"subjectAltName = {san}",
            "subjectKeyIdentifier = hash",
            "authorityKeyIdentifier = keyid,issuer",
            "",
        ]
    )


def fingerprint(cert_path: Path) -> str:
    """CA の証明書の SHA-256 指紋（スマホの「詳細」と見比べる）。"""
    der = ssl.PEM_cert_to_DER_cert(cert_path.read_text(encoding="ascii"))
    digest = hashlib.sha256(der).hexdigest().upper()
    return ":".join(digest[i : i + 2] for i in range(0, len(digest), 2))


class _OpenSsl:
    def __init__(self, binary: str, work: Path) -> None:
        self._bin = binary
        self._work = work

    def __call__(self, *args: str) -> str:
        try:
            done = subprocess.run(  # noqa: S603  引数はこのスクリプトが組み立てたものだけ
                [self._bin, *args],
                cwd=self._work,
                capture_output=True,
                text=True,
                timeout=OPENSSL_TIMEOUT_S,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            msg = f"openssl を実行できない（{type(exc).__name__}）"
            raise MakeTlsError(msg) from exc
        if done.returncode != 0:
            # 標準エラーには鍵の中身は出ない（鍵はファイルにだけ書く）。最後の 1 行だけ見せる
            last = (done.stderr.strip().splitlines() or ["(出力なし)"])[-1]
            msg = f"openssl {args[0]} が失敗した: {last}"
            raise MakeTlsError(msg)
        return done.stdout


def _write(work: Path, name: str, text: str) -> str:
    (work / name).write_text(text, encoding="utf-8")
    return name


def make(
    out: Path, ips: Sequence[ipaddress.IPv4Address], *, new_ca: bool, openssl: str
) -> tuple[bool, str]:
    """CA（無ければ・new_ca なら）とサーバー証明書を作る。戻り値は（CA を作ったか、CA の指紋）。"""
    ca_key, ca_crt = out / "ca.key", out / "ca.crt"
    have = (ca_key.exists(), ca_crt.exists())
    if have[0] != have[1] and not new_ca:
        msg = (
            "ca.key と ca.crt の片方だけがある（ca.key を車外へ移した？）。"
            "鍵を戻して打ち直すか、--new-ca で作り直す（スマホに入れ直す）"
        )
        raise MakeTlsError(msg)
    create_ca = new_ca or not all(have)

    out.mkdir(mode=0o700, parents=True, exist_ok=True)
    out.chmod(0o700)
    old_umask = os.umask(0o077)
    try:
        with tempfile.TemporaryDirectory(dir=out, prefix=".make_tls-") as tmp:
            work = Path(tmp)
            run = _OpenSsl(openssl, work)
            if create_ca:
                cfg = _write(work, "ca.cnf", ca_config(secrets.token_hex(4), ips))
                run(
                    "req", "-x509", "-new", "-newkey", "rsa:2048", "-nodes", "-sha256",
                    "-days", str(CA_DAYS), "-config", cfg, "-keyout", "ca.key", "-out", "ca.crt",
                )  # fmt: skip
                ca_paths = (work / "ca.key", work / "ca.crt")
            else:
                ca_paths = (ca_key, ca_crt)
            req = _write(work, "server.cnf", server_request_config())
            ext = _write(work, "server.ext", server_extensions(ips))
            run(
                "req", "-new", "-newkey", "rsa:2048", "-nodes", "-sha256", "-config", req,
                "-keyout", "server.key", "-out", "server.csr",
            )  # fmt: skip
            run(
                "x509", "-req", "-in", "server.csr", "-CA", str(ca_paths[1]),
                "-CAkey", str(ca_paths[0]), "-set_serial", "0x" + secrets.token_hex(16),
                "-days", str(SERVER_DAYS), "-sha256", "-extfile", ext, "-extensions", "v3_srv",
                "-out", "server.crt",
            )  # fmt: skip
            try:
                verified = run("verify", "-CAfile", str(ca_paths[1]), "server.crt")
            except MakeTlsError as exc:
                hint = "" if create_ca else "。CA の名前の制約に無い IP なら --new-ca が要る"
                msg = f"作ったサーバー証明書が CA で検証できない（{exc}）{hint}"
                raise MakeTlsError(msg) from exc
            if "OK" not in verified:
                msg = "作ったサーバー証明書が CA で検証できない"
                raise MakeTlsError(msg)
            for name in ("ca.key", "server.key"):
                if (work / name).exists():
                    (work / name).chmod(0o600)
            for name in ("ca.crt", "server.crt"):
                if (work / name).exists():
                    (work / name).chmod(0o644)
            # ここまで成功したときだけ差し替える（途中の失敗で既存を壊さない）
            if create_ca:
                (work / "ca.key").replace(ca_key)
                (work / "ca.crt").replace(ca_crt)
            (work / "server.key").replace(out / "server.key")
            (work / "server.crt").replace(out / "server.crt")
    finally:
        os.umask(old_umask)
    return create_ca, fingerprint(ca_crt)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="車ごとの CA とサーバー証明書を作る（pwa-https）")
    parser.add_argument(
        "--out", type=Path, required=True, help="出力のディレクトリ（git に入れない）"
    )
    parser.add_argument("--ip", action="append", default=[], help="AP の IP（私設の IPv4。複数可）")
    parser.add_argument("--new-ca", action="store_true", help="CA も作り直す（スマホに入れ直す）")
    parser.add_argument("--openssl", default=None, help="openssl のパス（既定は PATH から）")
    args = parser.parse_args(argv)
    try:
        ips = parse_ips(args.ip)
        openssl = args.openssl or shutil.which("openssl")
        if not openssl:
            msg = "openssl が見つからない（macOS は標準で入っている。Linux は apt install openssl）"
            raise MakeTlsError(msg)
        created, fp = make(args.out, ips, new_ca=args.new_ca, openssl=openssl)
    except MakeTlsError as exc:
        sys.stderr.write(f"make_tls: {exc}\n")
        return 2
    lines = [
        f"CA: {'作った' if created else 'そのまま（スマホに入れ直さなくてよい）'}",
        f"CA の SHA-256 指紋: {fp}",
        f"サーバー証明書: {SERVER_DAYS} 日（SAN: {', '.join([*HOSTS, *map(str, ips)])}）",
        "設定ページ（カードの URL の QR）:",
        *[f"  http://{ip}:{SETUP_PORT}/" for ip in ips],
    ]
    sys.stdout.write("\n".join(lines) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
