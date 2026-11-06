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
5. i18n の直書き禁止（ch5 多言語、docs/specs/i18n/functional.md R4）: UI の源のテストでない .ts / .tsx に、
   コメントを除いて仮名・漢字・ハングルが 1 字でも残るなら、次のどれかでなければ止める。
   (a) 名前の規則（text.ts・*-text.ts・i18n.ts）の表（workspace の i18n-tables.test.ts が自動で集めて 4 言語を検査する）
   (b) その workspace の i18n-tables.test.ts が相対パスで import するファイル（コメントに名前を書くだけでは通らない）
   (c) 下の ``I18N_EXEMPT`` にファイルと理由がある（利用者に出ない内部の例外の文・見本のデータなど）
   行の形ではなく文字で見るので、JSX の地の文・属性・throw の文・canvas に描く文も拾う。
   ``scripts/ci_arch_check.py`` は dispatcher 越しにこの規則を全追跡ファイルへ当てる（CI）。

例外を投げると dispatcher は終了コード 1（ブロックしない失敗）で落ちて画面に出る。黙って通す書き方にしない。
自己テスト: python scripts/tests/test_antler_hooks.py
"""
from __future__ import annotations

import os
import posixpath
import re
from pathlib import Path

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

# 規則 5: i18n の直書き
#: 検査する UI の源 → その workspace の 4 言語の検査（i18n-tables.test.ts。None は検査のテストが無い場所）
_I18N_WORKSPACES: dict[str, str | None] = {
    "apps/sim/src/": "apps/sim/src/i18n-tables.test.ts",
    "apps/pwa/src/": "apps/pwa/src/i18n-tables.test.ts",
    "packages/alert-ui/src/": "packages/alert-ui/src/i18n-tables.test.ts",
    "packages/trip/src/": "packages/trip/src/i18n-tables.test.ts",
    "apps/api/src/infrastructure/http/views/": None,
}
_I18N_TABLE_NAME = re.compile(r"(?:^|/)(?:text|[^/]*-text|i18n)\.ts$")
_TS_EXT = re.compile(r"\.tsx?$")
#: 仮名・漢字・ハングル（@antler/i18n-check の hasCjk と同じ範囲。中黒「・」と長音「ー」は Common なので入れない）
_CJK = re.compile(
    "[ぁ-ゖゝ-ゟァ-ヺヽ-ヿㇰ-ㇿｦ-ｯｱ-ﾝ"
    "⺀-⿟々〇〡-〩〸-〻㐀-䶿一-鿿豈-﫿"
    "\U00020000-\U0003ffffᄀ-ᇿㄱ-ㆎꥠ-꥿가-힣ힰ-퟿ﾠ-ￜ]"
)
_REL_IMPORT = re.compile(r"""\b(?:from|import)\s*\(?\s*['"](\.{1,2}/[^'"]+)['"]""")
#: 正規表現リテラルが始まりうる直前の文字（それ以外の / は割り算）
_REGEX_BEFORE = set("(,=:[!&|?{};+-*%~^") | {""}

#: 例外（ファイル → 理由）。利用者の画面に 1 言語の文が出ないことを確かめてから足す
I18N_EXEMPT: dict[str, str] = {
    "apps/sim/src/main.tsx": "#root が無いときの開発者向けの例外の文（画面に出ない）",
    "apps/pwa/src/main.tsx": "#root が無いときの開発者向けの例外の文（画面に出ない）",
    "apps/sim/src/features/drive/domain/rng.ts": "内部の例外の文（引数の誤り。画面に出ない）",
    "apps/sim/src/features/drive/domain/road.ts": "内部の例外の文（引数の誤り。画面に出ない）",
    "apps/sim/src/features/drive/scene/frame-state.ts": "開発者向けの例外の文（フックの使い方の誤り）",
    "apps/sim/src/features/drive/scene/mesh-utils.ts": "内部の例外の文（形の属性の不一致。画面に出ない）",
    "apps/sim/src/features/drive/chat/tourism.ts": "鹿の語を見つける正規表現（4 言語の語を並べた検出用。表示しない）",
    "apps/sim/src/features/drive/domain/scenario.ts":
        "見本の旅の TripPlan（plan.title は旅の言語の 1 文の欄。見本の場面の見出しは HUD_TEXT.start.title を出す）",
    "apps/sim/src/features/plan-trip/components/LangSelect.tsx":
        "言語の名前はその言語自身で書く（自称。どの言語の画面からでも読めるように 4 言語を訳さない）",
    "apps/sim/src/features/plan-trip/hooks/useCreateTrip.ts": "内部の例外の文（応答の形の誤り。画面は status で出し分ける）",
    "apps/sim/src/features/plan-trip/utils/photos.ts": "写真の台帳の検証の文（ビルド時のデータの検査。画面に出ない）",
    "apps/sim/src/features/record/test-fixtures.ts": "テスト用の見本のデータ（画面に出ない）",
    "apps/pwa/src/features/connect/lib/zones-loader.ts": "内部の例外の文（ゾーン DB の検証。画面は状態で出し分ける）",
    "packages/alert-ui/src/sound/web-audio-port.ts": "内部の例外の文（AudioContext が無い。音の状態で出し分ける）",
    "packages/trip/src/day/day-plan.ts": "内部の例外の文（api は code で返し、画面は code で出し分ける）",
    "packages/trip/src/day/rng.ts": "内部の例外の文（引数の誤り。画面に出ない）",
    "packages/trip/src/day/roads.ts": "内部の例外の文（地点の id の誤り。画面に出ない）",
    "packages/trip/src/day/road-pairs.ts": "冬に閉まる道の名前（経路の取得スクリプトの注記。画面に出ない）",
    "packages/trip/src/plan.ts": "内部の例外の文（楽しみの id の誤り。画面に出ない）",
    "packages/trip/src/pleasures.ts": "楽しみの台帳の検証の文（データの検査。画面に出ない）",
    "apps/api/src/infrastructure/http/views/og-image-renderer.ts":
        "api の JSON の message（OG_BUSY。画面は code で出し分ける）",
}


def _project_root() -> Path:
    """dispatcher と同じ案件のルート（``CLAUDE_PROJECT_DIR``、無ければ ``.claude/hooks/`` の 2 つ上）。"""
    env = os.environ.get("CLAUDE_PROJECT_DIR")
    return Path(env).resolve() if env else Path(__file__).resolve().parents[2]


def _regex_keyword_before(tail: str) -> bool:
    """`=> /x/`・`return /x/` のように、記号でなく語の後ろで正規表現リテラルが始まるか。"""
    return tail.endswith("=>") or re.search(r"(?<![.\w])(?:return|typeof|case)$", tail) is not None


def strip_comments(src: str) -> str:
    """// と /* */ のコメントを除く（文字列・テンプレート・正規表現リテラルの中は残す）。"""
    out: list[str] = []
    i, n = 0, len(src)
    quote: str | None = None
    prev = ""  # 直前の空白でない文字（正規表現か割り算かの見分け）
    while i < n:
        c = src[i]
        if quote:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(src[i + 1])
                i += 2
                continue
            if c == quote:
                quote = None
                prev = c
            i += 1
            continue
        if c in "'\"`":
            quote = c
            out.append(c)
            i += 1
            continue
        if src.startswith("//", i):
            j = src.find("\n", i)
            i = n if j < 0 else j
            continue
        if src.startswith("/*", i):
            j = src.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        if c == "/" and (prev in _REGEX_BEFORE or _regex_keyword_before("".join(out[-16:]).rstrip())):
            # 正規表現リテラル: 閉じの / まで（文字クラスの中の / と、エスケープは飛ばす）
            j, in_class = i + 1, False
            while j < n and src[j] != "\n":
                if src[j] == "\\":
                    j += 2
                    continue
                if src[j] == "[":
                    in_class = True
                elif src[j] == "]":
                    in_class = False
                elif src[j] == "/" and not in_class:
                    break
                j += 1
            out.append(src[i:j + 1])
            i = j + 1
            prev = "/"
            continue
        out.append(c)
        if not c.isspace():
            prev = c
        i += 1
    return "".join(out)


def _i18n_registered(relative: str, test_rel: str) -> bool:
    """workspace の i18n-tables.test.ts が、相対パスの import でこのファイルを読んでいるか。"""
    path = _project_root() / test_rel
    if not path.is_file():
        return False
    src = strip_comments(path.read_text(encoding="utf-8", errors="replace"))
    target = _TS_EXT.sub("", relative)
    base = posixpath.dirname(test_rel)
    for match in _REL_IMPORT.finditer(src):
        spec = re.sub(r"\.(?:tsx?|jsx?)$", "", match.group(1))
        resolved = posixpath.normpath(posixpath.join(base, spec))
        if resolved in (target, posixpath.join(target, "index")) or f"{resolved}/index" == target:
            return True
    return False


def i18n_violation(relative: str, text: str) -> str | None:
    """規則 5。違反なら理由の文、なければ None。"""
    workspace = next((w for w in _I18N_WORKSPACES if relative.startswith(w)), None)
    if workspace is None or not _TS_EXT.search(relative) or _I18N_TABLE_NAME.search(relative):
        return None
    if relative in I18N_EXEMPT:
        return None
    found = _CJK.search(strip_comments(text))
    if not found:
        return None
    test_rel = _I18N_WORKSPACES[workspace]
    if test_rel and _i18n_registered(relative, test_rel):
        return None
    where = (f"その workspace の `{test_rel}` が相対パスで import する表" if test_rel
             else "（ここには 4 言語の検査のテストが無いので）表を名前の規則のファイルに移して呼び出し側で言語を選ぶ")
    return (f"i18n: 画面の文 `{found.group(0)}…` を 4 言語の表の外に直書きしています。"
            "文言は名前の規則（text.ts・*-text.ts・i18n.ts）の 4 言語の表に置くか、"
            f"{where}にする。利用者に出ない文なら .claude/hooks/dispatch_local_rules.py の I18N_EXEMPT に理由つきで足す"
            "（docs/specs/i18n/functional.md R4）。")


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


def _edited_file(tool_input: dict, relative: str) -> str | None:
    """編集を当てたあとのファイル全体（Write はその中身）。読めない・当てられないときは None（断片で見る）。"""
    content = tool_input.get("content")
    if isinstance(content, str):
        return content
    try:
        text = (_project_root() / relative).read_text(encoding="utf-8")
    except OSError:
        return None
    for edit in tool_input.get("edits") or [tool_input]:
        if not isinstance(edit, dict):
            return None
        old, new = edit.get("old_string"), edit.get("new_string")
        if not isinstance(old, str) or not isinstance(new, str) or old not in text:
            return None
        text = text.replace(old, new) if edit.get("replace_all") else text.replace(old, new, 1)
    return text


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

    # 規則 5 は「ファイルに仮名・漢字・ハングルが残るか」を見るので、断片でなく編集後のファイル全体で見る
    # （断片だと、コメントの途中の書き換えが外側の /* を失って文字列に見える）
    i18n = i18n_violation(relative, _edited_file(tool_input, relative) or text)
    if i18n:
        out.append(i18n)

    return out
