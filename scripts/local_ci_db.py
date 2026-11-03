"""確認つきのテスト DB 作り直し（local-ci の部品。PostgreSQL 専用）。

DB を使う検査は、検査の前に DB を作り直したくなる。ここでの危険は **別の DB を消すこと**
（共用の開発サーバや、別の作業ツリーのテスト DB）。そこで、消す前に次を全部満たすことを要求する。
どれか 1 つでも欠ければ**消さずに止まる**（検査は fail。見送りにしない）。

1. 接続先は**このマシン**（localhost / 127.0.0.1 / ::1）。リモートは拒否する
2. 消す DB の名前は **``prefix`` + 作業ツリーごとの 8 桁（{SLUG}）にぴったり一致**する。
   ``postgres`` や、slug を含まない名前（= 共用の DB）は、この条件で消せない
3. 既にある DB は、**この道具が作ったという印**（DB のコメント ``local-ci:<slug>``）が付いている
   ときだけ消す。印が無い（= 人が作った・別の道具が作った）DB は、名前が合っていても消さない

接続先のサーバが本当に想定のものか（バージョンやデータの置き場）までは見ていない。
名前と印で守っているだけで、別のサーバが同じ名前で同じ印を持つことまでは防げない。

実行は ``psql`` コマンド（PATH に無ければ呼び出し側が見送る）。環境変数 ``LOCAL_CI_PSQL`` で
コマンドの先頭部分を差し替えられる（試験用。実運用では設定しない）。
"""
from __future__ import annotations

import os
import re
import shlex
import subprocess
from urllib.parse import urlsplit, urlunsplit

LOCAL_HOSTS = ("localhost", "127.0.0.1", "::1")
PROTECTED = ("postgres", "template0", "template1")
_NAME = re.compile(r"^[a-z][a-z0-9_]*$")
_PREFIX = re.compile(r"^[a-z][a-z0-9_]{2,}_$")
MARKER_PREFIX = "local-ci:"


class DbRefused(Exception):
    """消してはいけない（または作れない）。理由は文面。"""


def valid_prefix(prefix: str) -> bool:
    """prefix は 4 文字以上・小文字英数字とアンダースコア・末尾 ``_``（``test_`` のような短すぎる接頭辞を避ける）。"""
    return bool(_PREFIX.match(prefix)) and len(prefix) >= 4


def target_of(url: str, prefix: str, slug: str) -> tuple[str, str]:
    """(消す DB の名前, 管理用の接続 URL)。**消してよくない組み合わせなら DbRefused**。"""
    if not valid_prefix(prefix):
        raise DbRefused(f"prefix {prefix!r} は小文字英数字とアンダースコアで、4 文字以上・末尾 _ にしてください")
    parts = urlsplit(url)
    if parts.scheme not in ("postgresql", "postgres"):
        raise DbRefused(f"PostgreSQL の URL だけ扱える（scheme={parts.scheme!r}）")
    host = (parts.hostname or "").lower()
    if host not in LOCAL_HOSTS:
        raise DbRefused(f"接続先 {host or '（無し）'} はこのマシンではない。リモートの DB は作り直さない")
    name = parts.path.lstrip("/")
    expected = f"{prefix}{slug}"
    if name in PROTECTED:
        raise DbRefused(f"{name!r} は保護された DB")
    if not _NAME.match(name):
        raise DbRefused(f"DB 名 {name!r} は小文字英数字とアンダースコアだけ（引用符などは拒否）")
    if name != expected:
        raise DbRefused(f"DB 名 {name!r} が {expected!r}（prefix + 作業ツリーの 8 桁）と一致しない。"
                        "共用の DB を消さないため、この名前では作り直さない")
    admin = urlunsplit((parts.scheme, parts.netloc, "/postgres", "", ""))
    return name, admin


def _psql(admin_url: str, sql: str) -> tuple[int, str]:
    base = shlex.split(os.environ.get("LOCAL_CI_PSQL") or "psql")
    r = subprocess.run([*base, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", admin_url, "-c", sql],
                       capture_output=True, timeout=120)
    out = (r.stdout + r.stderr).decode("utf-8", "replace").strip()
    return r.returncode, out


def psql_command() -> str:
    """見送りの判定に使う、psql の実行ファイル名（先頭の語）。"""
    base = shlex.split(os.environ.get("LOCAL_CI_PSQL") or "psql")
    return base[0]


def recreate(url: str, prefix: str, slug: str, say=print) -> str:
    """DB を作り直し、使う URL を返す。消してはいけないときは DbRefused。"""
    name, admin = target_of(url, prefix, slug)
    marker = f"{MARKER_PREFIX}{slug}"
    rc, out = _psql(admin, "SELECT 'exists:' || COALESCE(shobj_description(oid, 'pg_database'), '') "
                           f"FROM pg_database WHERE datname = '{name}'")
    if rc != 0:
        raise DbRefused(f"DB の有無を確かめられない（psql rc={rc}: {out[-200:]}）")
    if out.startswith("exists:"):
        found = out[len("exists:"):].strip()
        if found != marker:
            raise DbRefused(f"DB {name!r} は既にあるが、local-ci が作った印（{marker!r}）が無い"
                            f"（コメント: {found!r}）。人が作った DB かもしれないので消さない。"
                            "消してよいと確かめたら手で DROP すること")
        say(f"    · DB {name} を作り直す（local-ci が作った印を確認済み）")
        rc, out = _psql(admin, f'DROP DATABASE "{name}" WITH (FORCE)')
        if rc != 0:
            raise DbRefused(f"DB {name!r} を消せない（psql rc={rc}: {out[-200:]}）")
    else:
        say(f"    · DB {name} を新しく作る")
    rc, out = _psql(admin, f'CREATE DATABASE "{name}"')
    if rc != 0:
        raise DbRefused(f"DB {name!r} を作れない（psql rc={rc}: {out[-200:]}）")
    rc, out = _psql(admin, f"COMMENT ON DATABASE \"{name}\" IS '{marker}'")
    if rc != 0:
        raise DbRefused(f"DB {name!r} に印を付けられない（psql rc={rc}: {out[-200:]}）。"
                        "印が無いと次回は消せないので、手で消してから回し直すこと")
    return url
