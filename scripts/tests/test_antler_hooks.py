"""antler 固有の hook の自己テスト（.claude/hooks/dispatch_local_rules.py と ch9-status.py）。

    python scripts/tests/test_antler_hooks.py

失敗があれば終了コード 1。外部パッケージを使わない。
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HOOKS = ROOT / ".claude" / "hooks"
failures: list[str] = []


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def check(label: str, ok: bool) -> None:
    print(("ok   " if ok else "FAIL ") + label)
    if not ok:
        failures.append(label)


rules = load("dispatch_local_rules", HOOKS / "dispatch_local_rules.py")
ch9 = load("ch9_status", HOOKS / "ch9-status.py")


def denied(rel: str, content: str, stack: str = "sim", key: str = "content") -> list[str]:
    return rules.local_violations({key: content}, rel, stack)


# 規則 1: 色
check("UI に 16 進色 → 止める", any("tokens.json" in m for m in denied("apps/pwa/src/features/drive/View.tsx", "color: '#1E6F5C'")))
check("UI に rgba() → 止める", bool(denied("packages/alert-ui/src/AlertState.tsx", "boxShadow: 'rgba(0,0,0,.2)'", "packages")))
check("Edit の new_string も見る", bool(denied("apps/sim/src/x.tsx", "fill='#fff'", key="new_string")))
check("MultiEdit の edits も見る", bool(rules.local_violations({"edits": [{"new_string": "#abcdef"}]}, "apps/sim/src/x.css", "sim")))
check("var(--spruce) は通す", denied("apps/sim/src/x.tsx", "color: 'var(--spruce)'") == [])
check("生成物 tokens.css は通す", denied("packages/alert-ui/src/tokens.css", "--spruce: #1E6F5C;", "packages") == [])
check("3D の配色表は通す", denied("apps/sim/src/features/drive/scene/palette.ts", "snow: '#F4F6F8'") == [])
check("配色表でも alert-danger の赤は止める",
      any("alert-danger" in m for m in denied("apps/sim/src/features/drive/scene/palette.ts", "bad: '#e2492c'")))
check("配色表でも新しい alert-danger の赤（#D83B1E）は止める",
      any("alert-danger" in m for m in denied("apps/sim/src/features/drive/scene/palette.ts", "bad: '#D83B1E'")))
check("api の色は対象外", denied("apps/api/src/og.ts", "fill: '#1E6F5C'", "api") == [])
check("テストは対象外", denied("apps/pwa/src/features/drive/View.test.tsx", "'#E2492C'") == [])
check("HTML 実体参照 &#123; は色にしない", denied("apps/sim/src/x.tsx", "&#123;") == [])

# 規則 2: 統計の数字
check("6705 → 止める", any("stats.json" in m for m in denied("apps/sim/src/features/loss/Loss.tsx", "const n = 6705")))
check("6,705 → 止める", bool(denied("apps/sim/src/features/loss/Loss.tsx", "'6,705件'")))
check("61.5万 → 止める", bool(denied("apps/sim/src/features/loss/Loss.tsx", "'平均 61.5 万円'")))
check("edge の Python も見る", bool(denied("edge/detector/report.py", "TOTAL = 6705", "edge")))
check("緯度 43.1751 は数字の一部として扱わない", denied("packages/zones/src/build.ts", "const p = [144.1, 43.1751]", "packages") == [])
check("167051 は別の数", denied("apps/sim/src/x.ts", "const id = 167051") == [])
check("stats.json 自体は対象外", denied("packages/trip/data/stats.json", '"total": 6705') == [])

# 規則 3: Capture の個人情報
check("Capture に lat → 止める", any("roadSegment" in m for m in denied("packages/schema/src/capture.ts", "lat: number", "packages")))
check("Python の dict キー \"email\": → 止める", bool(denied("edge/detector/capture_store.py", 'row = {"email": e}', "edge")))
check("Capture に roadSegment は通す", denied("packages/schema/src/capture.ts", "roadSegment: string", "packages") == [])
check("capture 以外のファイルの lat は対象外", denied("packages/zones/src/zone.ts", "lat: number", "packages") == [])

# 規則 4: 絵文字
check("UI に絵文字 → 止める", bool(denied("apps/pwa/src/features/drive/View.tsx", "<span>\U0001F98C</span>", "pwa")))
check("✓ ✕ は通す", denied("apps/sim/src/features/plan/Strip.tsx", "<span>✓</span><span>✕</span>") == [])

# 規則 5: i18n の直書き（docs/specs/i18n/functional.md R4、INV-2）
def i18n(rel: str, content: str, key: str = "content") -> bool:
    return any(m.startswith("i18n:") for m in denied(rel, content, key=key))


UI = "apps/sim/src/features/drive/components/Thing.tsx"
check("INV-2: JSX の地の文 → 止める", i18n(UI, "export const T = () => <p>出発</p>\n"))
check("INV-2: JSX の属性 → 止める", i18n(UI, "export const T = () => <svg aria-label=\"鹿\" />\n"))
check("INV-2: throw の文 → 止める", i18n("apps/pwa/src/features/x/y.ts", "throw new Error('壊れた')\n"))
check("INV-2: ハングルだけでも止める", i18n(UI, "const k = '출발'\n"))
check("INV-2: Prettier の折り返し（文字列が次の行）→ 止める",
      i18n(UI, "const msg =\n  cond\n    ? 'Loading'\n    : '読み込み中'\n"))
check("INV-2: 外側が言語の表でも名前の規則の外なら止める",
      i18n("apps/sim/src/features/drive/components/labels.ts",
           "export const L = {\n  ja: { go: '出発' },\n  en: { go: 'Go' },\n}\n"))
check("INV-2: Edit の new_string も見る", i18n(UI, "<p>出発</p>", key="new_string"))
check("INV-2: alert-ui・trip・api の SSR も見る",
      i18n("packages/alert-ui/src/x.tsx", "<p>鹿</p>") and i18n("packages/trip/src/x.ts", "'鹿'")
      and i18n("apps/api/src/infrastructure/http/views/page.ts", "'鹿'"))
check("INV-2: コメントだけのファイルは通す",
      not i18n(UI, "// 出発の案内\n/** 鹿ゾーン */\nexport const T = () => <p>{/* 説明 */}{t.go}</p>\n"))
check("INV-2: URL の // の後ろの文字列は残す（コメントにしない）",
      i18n(UI, "const u = 'https://example.com'; const s = '鹿'\n"))
check("INV-2: 正規表現の中の ' で文字列を取り違えない",
      not i18n(UI, "const q = s.replace(/'/g, '&#39;')\n// 幅の目安\n"))
check("INV-2: 中黒・長音・全角記号だけは通す", not i18n(UI, "const sep = '・'; const bar = 'ー'; const p = '（'\n"))
check("INV-2: 名前の規則の表（*-text.ts・text.ts・i18n.ts）は通す",
      not i18n("apps/sim/src/features/drive/components/hud/hud-text.ts", "ja: '出発'")
      and not i18n("apps/sim/src/features/loss/text.ts", "ja: '出発'")
      and not i18n("packages/alert-ui/src/i18n/i18n.ts", "ja: '出発'"))
check("INV-2: i18n-tables.test.ts が相対パスで import する表は通す（trip の locale.ts）",
      not i18n("packages/trip/src/locale.ts", "const ABOUT = { ja: '約' }"))
check("INV-2: 例外の表（理由つき）のファイルは通す", not i18n("apps/sim/src/main.tsx", "throw new Error('無い')"))
check("INV-2: 例外の表のファイルは全部実在し、理由がある",
      all((ROOT / path).is_file() and reason.strip() for path, reason in rules.I18N_EXEMPT.items()))
check("INV-2: テストは対象外", not i18n("apps/sim/src/features/drive/components/Thing.test.tsx", "'出発'"))
check("INV-2: UI の源の外（api の domain・scripts）は対象外",
      not i18n("apps/api/src/domain/trips/x.ts", "'出発'") and not i18n("packages/trip/scripts/x.ts", "'出発'"))

# ch9-status
TABLE = """# x
### 判断記録

| # | 項目 | 推奨 | 判断 | 状態 | メモ |
| --- | --- | --- | --- | --- | --- |
| ① | ルート表示 | d | d | 確定 | |
| ③ | 鹿モデル | c＋d | | 要確認 | 欄が空 |
| ③ | 予算 | — | 未 | | |

### 次の節
| a | b |
| --- | --- |
| 1 | 2 |
"""
rows = ch9.parse(TABLE)
check("判断記録の表だけを読む", len(rows) == 3)
lines = ch9.summary(rows)
check("確定の行は出さない", not any("ルート表示" in line for line in lines))
check("空欄・要確認・未の行を出す", len(lines) == 2 and "c＋d" in lines[0])
real = ch9.parse((ROOT / "docs/requirements/ch9-decisions.md").read_text(encoding="utf-8"))
check("リポジトリの ch9-decisions.md に判断記録がある", len(real) >= 5)

print(f"\n{'FAILED' if failures else 'OK'}: {len(failures)} 件失敗")
sys.exit(1 if failures else 0)
