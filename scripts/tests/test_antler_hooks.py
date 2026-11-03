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
