"""antler（EZO ROAD）固有の規則。dispatcher（dispatch-architecture.py）が Write / Edit / MultiEdit のときに呼ぶ。

stack のチェッカー（Amptech 由来）は案件ごとに直さない約束なので、antler だけの決まりはここに置く。
止めるのは**置き場所と文字列で機械的に決まるものだけ**。判断を要するもの（alert-danger を検知以外に使っていないか、
AlertState の props が README どおりか、など）は alert-contract-guard エージェントのレビューに残す。

規則（根拠は docs/requirements の章）:

1. 色の直書き禁止（ch8 規約 1・3）: UI のソースに 16 進色・rgb()/hsl() を書かない。tokens.json から生成した
   CSS 変数 / TS 定数を使う。例外は生成物（tokens.css / tokens.ts）と 3D シーンの配色表（scene/palette.ts）。
   ただし alert-danger の赤（#D83B1E。2026-11-03 までの #E2492C も）は配色表にも書けない（検知以外に使わない）。
2. 統計の数字の直書き禁止（A6-3）: 事故件数・保険金の実数はコードに埋めず stats.json から読む。
3. Capture に個人情報・精密位置を入れない（ch5「保存しない」）: パスに capture を含むファイルで、
   氏名・メール・電話・端末識別子・緯度経度のキーを書かない（B は道路区間 ID に丸める）。
4. 絵文字を使わない（ch8 規約 7）: アイコンはインライン SVG。✓ ✕ などの記号（U+2700 台）は対象外。

例外を投げると dispatcher は終了コード 1（ブロックしない失敗）で落ちて画面に出る。黙って通す書き方にしない。
自己テスト: python scripts/tests/test_antler_hooks.py
"""
from __future__ import annotations

import re

STATS_FILE = "packages/trip/data/stats.json"

_CODE_EXT = re.compile(r"\.(?:tsx?|jsx?|mjs|cjs|css|scss)$")
_PY_OR_CODE_EXT = re.compile(r"\.(?:tsx?|jsx?|mjs|cjs|py)$")
_TEST = re.compile(r"(?:^|/)(?:__tests__|tests?)/|\.(?:test|spec)\.[^/]+$|(?:^|/)test_[^/]+\.py$")

# 規則 1: 色。UI を描く場所だけ
_UI_DIRS = re.compile(r"^(?:apps/(?:sim|pwa)/src/|packages/alert-ui/src/)")
_TOKEN_OUTPUT = re.compile(r"(?:^|/)tokens\.(?:css|ts)$")
_SCENE_PALETTE = re.compile(r"^apps/sim/src/.*/scene/palette\.ts$")
_HEX = re.compile(r"(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b")
_FUNC_COLOR = re.compile(r"\b(?:rgba?|hsla?)\(\s*\d")
_DANGER_RED = re.compile(r"#(?:d83b1e|e2492c)\b", re.IGNORECASE)

# 規則 2: 統計の実数（6,705 件・5,460 件・1,751 件・1,229 件・7.56 億円・61.5 万円・890 万円）
_STATS = re.compile(
    r"(?<![\d.])(?:6[,_]?705|5[,_]?460|1[,_]?751|1[,_]?229|615[,_]?000|8[,_]?900[,_]?000|756[,_]?000[,_]?000)(?![\d])"
    r"|7\.56\s*億|61\.5\s*万|890\s*万"
)

# 規則 3: Capture の個人情報・精密位置
_CAPTURE_PATH = re.compile(r"captures?", re.IGNORECASE)
_PII_KEYS = re.compile(
    r"\b(?:e_?mail|full_?name|user_?name|phone(?:_?number)?|device_?id|udid|idfa|imei|mac_?address"
    r"|lat|lng|lon|latitude|longitude)\b['\"]?\s*[:=?]",
    re.IGNORECASE,
)

# 規則 4: 絵文字（記号の U+2700 台は ✓ ✕ を使うので除く）
_EMOJI = re.compile("[\U0001F000-\U0001FAFF]")


def _new_text(tool_input: dict) -> str:
    """この編集で書き込まれる文字列。既存の部分は裁かない（新しく書いた分だけ）。"""
    parts: list[str] = []
    for key in ("content", "new_string"):
        value = tool_input.get(key)
        if isinstance(value, str):
            parts.append(value)
    for edit in tool_input.get("edits") or []:
        if isinstance(edit, dict) and isinstance(edit.get("new_string"), str):
            parts.append(edit["new_string"])
    return "\n".join(parts)


def _first(pattern: re.Pattern[str], text: str) -> str | None:
    match = pattern.search(text)
    return match.group(0) if match else None


def local_violations(tool_input: dict, relative: str, stack: str) -> list[str]:
    if _TEST.search(relative):
        return []
    text = _new_text(tool_input)
    if not text:
        return []
    out: list[str] = []

    if _UI_DIRS.search(relative) and _CODE_EXT.search(relative) and not _TOKEN_OUTPUT.search(relative):
        red = _first(_DANGER_RED, text)
        if red:
            out.append(f"alert-danger の赤 `{red}` を直書きしています。赤は検知（AlertState danger）専用で、"
                       "tokens の `--alert-danger` 経由でだけ使う（docs/requirements/ch8-design.md 規約 3）。")
        elif not _SCENE_PALETTE.search(relative):
            color = _first(_HEX, text) or _first(_FUNC_COLOR, text)
            if color:
                out.append(f"色 `{color}` を直書きしています。docs/design/tokens.json から生成した CSS 変数"
                           "（`var(--spruce)` など）か TS 定数を使う（ch8 規約 1）。3D シーンの配色は "
                           "`apps/sim/src/**/scene/palette.ts` にまとめる。")

    if _PY_OR_CODE_EXT.search(relative) and relative.startswith(("apps/", "packages/", "edge/")):
        stat = _first(_STATS, text)
        if stat:
            out.append(f"統計の実数 `{stat}` をコードに埋めています。{STATS_FILE} から読み、出典と一緒に表示する（A6-3）。")

    if _CAPTURE_PATH.search(relative) and _PY_OR_CODE_EXT.search(relative):
        key = _first(_PII_KEYS, text)
        if key:
            key = key.rstrip(":=? '\"")
            out.append(f"Capture まわりに個人情報・精密位置のキー `{key}` があります。"
                       "氏名・メール・端末識別子・緯度経度は保存しない。位置は roadSegment（道路区間 ID）に丸める"
                       "（docs/requirements/ch5-common.md「データ収集と同意」）。")

    if _UI_DIRS.search(relative) and _CODE_EXT.search(relative):
        emoji = _first(_EMOJI, text)
        if emoji:
            out.append(f"絵文字 `{emoji}` を使っています。アイコンはインライン SVG（stroke）にする（ch8 規約 7）。")

    return out
