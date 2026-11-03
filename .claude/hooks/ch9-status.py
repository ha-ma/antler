"""SessionStart hook: 第 9 章の判断記録を読み、空欄・要確認の項目をセッションの冒頭に知らせる。

判断はチャットではなく docs/requirements/ch9-decisions.md の「判断記録」表に書く約束（CLAUDE.md）。
口頭の回答は次のセッションに残らないので、毎回ここから読み直させる。
stdout はセッションの文脈に入る。表が読めなくても止めない（終了コード 0）が、黙りもしない。

自己テスト: python scripts/tests/test_antler_hooks.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

DECISIONS = Path("docs/requirements/ch9-decisions.md")
PENDING = {"", "未", "-", "—"}


def parse(text: str) -> list[dict[str, str]]:
    """「判断記録」節の表を行の辞書にする。見出しの列名をキーにする。"""
    rows: list[dict[str, str]] = []
    header: list[str] | None = None
    in_section = False
    for line in text.splitlines():
        if line.startswith("#"):
            in_section = line.lstrip("#").strip() == "判断記録"
            header = None
            continue
        if not in_section or not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if header is None:
            header = cells
        elif set("".join(cells)) <= set("-: "):
            continue
        else:
            rows.append(dict(zip(header, cells)))
    return rows


def summary(rows: list[dict[str, str]]) -> list[str]:
    out: list[str] = []
    for r in rows:
        name = f"{r.get('#', '')} {r.get('項目', '')}".strip()
        decided = r.get("判断", "")
        state = r.get("状態", "")
        if decided in PENDING or state in ("仮採用", "要確認"):
            fallback = r.get("推奨", "")
            action = "推奨なし。ユーザーの記入待ち" if fallback in PENDING else f"推奨「{fallback}」を仮採用"
            note = f"（{r['メモ']}）" if r.get("メモ") else ""
            out.append(f"- {name}: 判断「{decided or '空欄'}」・状態「{state or '空欄'}」→ {action}{note}")
    return out


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
    root = Path(os.environ.get("CLAUDE_PROJECT_DIR") or ".")
    path = root / DECISIONS
    if not path.is_file():
        print(f"[ch9] {DECISIONS} がありません。第 9 章の判断を確かめられていません。")
        return 0
    rows = parse(path.read_text(encoding="utf-8"))
    if not rows:
        print(f"[ch9] {DECISIONS} に「判断記録」の表が見つかりません。判断を確かめられていません。")
        return 0
    pending = summary(rows)
    if not pending:
        print(f"[ch9] 第 9 章の判断はすべて確定（{DECISIONS}）。")
        return 0
    print(f"[ch9] 第 9 章に未確定の判断が {len(pending)} 件あります（{DECISIONS}）。"
          "該当する feature に触れるときは、推奨を仮採用して PR に「仮採用」と書くか、ユーザーに判断欄への記入を頼む:")
    print("\n".join(pending))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
