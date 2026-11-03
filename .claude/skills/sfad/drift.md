# SFAD Drift — 仕様とコードの乖離検出

仕様は「書いた日だけ正しい文書」になりやすい。`/sfad drift` は仕様とコードを
相互監視させ、乖離が生まれた瞬間に音を鳴らす。

## Invocation

```
/sfad drift               # docs/specs/ の全 feature を検査
/sfad drift orders        # 特定 feature のみ
```

実体は決定的スクリプト（`hooks/sfad-drift.py`。`/sfad init` が `.claude/hooks/` に配置）:

```
python .claude/hooks/sfad-drift.py [feature ...]
# exit 0 = クリーン / 1 = drift あり / 2 = 実行エラー
```

CI に組み込む場合は quality-check の1ステップとして同コマンドを実行する。

## 検査内容（決定的なもののみ）

| 検査 | 内容 | 検出時 |
|------|------|--------|
| **STALE** | 仕様の最終コミット以降に `target_paths` のコードだけが変更されている | DRIFT |
| **THREAT GAP** | コードに実在するルート/エンドポイントが threat.md の操作列に無い（FastAPI / Hono / Laravel / Next.js のルート定義を best-effort 検出） | DRIFT |
| **BRIDGE GAP** | functional.md の `Rule → ドメイン語彙対応` 表の置き場所が実在しない | DRIFT |
| **COVERAGE GAP** | Test List の `{接頭辞}-{N}` に対応するテストがリポジトリのどのテストファイルにも無い（仕様→テストの向き） | DRIFT |
| **AUTHZ COVERAGE GAP** | 認可マトリクスの ❌ セル数を Test List の AUTH-* 件数が下回っている（埋めさせた拒否が検証に届いていない） | DRIFT |
| **CONTRACT GAP** | threat.md の操作列にあるルートがコードから消えた（THREAT GAP の逆向き＝無記録の破壊的変更） | DRIFT |
| **INVALID BASE** | `spec_confirmed_at` の SHA から履歴を辿れない（typo・rebase 消失等） | DRIFT |
| SHA 未記入 | `spec_confirmed_at` が未記入で drift 検出が無効 | INFO |

**plan.md は検査対象外** — 完了後にアーカイブされる「腐ってよい文書」（設計上の決定）。

## drift が出たときの直し方

1. **仕様を先に直す**（コードに合わせて functional/threat を更新、または不要な変更なら revert）
2. `spec_confirmed_at` を現在のコミット SHA に進める
3. `/sfad drift` を再実行してクリーンを確認

**コードだけ直して仕様を放置しない** — それが STALE の再生産になる。

**COVERAGE GAP だけは向きが逆**: 仕様は正しく、テストが追いついていない状態。
仕様を消して辻褄を合わせるのではなく、`/sfad test {識別子}` で不足分を生成し、
Red → Green を回して埋める。Test List から項目を削るのは、その振る舞いを
提供しないとユーザーが決めたときだけ。

## Rule → ドメイン語彙対応（橋）

仕様の Rule とドメインコードの語彙を1対1で追跡する表（Tier 2 推奨）。
仕様の言葉とコードの言葉が一致しているかを BRIDGE GAP 検査が機械的に監視する
— ユビキタス言語の機械強制。

```markdown
## Rule → ドメイン語彙対応

| Rule | 語彙 | 置き場所 | 証明 |
|------|------|---------|------|
| R1: 前日までは全額返金 | RefundPolicy | src/app/orders/_domain/policies | UC-2, UC-3 |
| R2: キャンセル済みは再操作不可 | CancellationRules | src/app/orders/_domain/rules | UC-4 |
```

置き場所の命名はスタック層の規約が正（例: FastAPI は `domain/{domain}/policies/`、
Laravel は `app/Domain/{Domain}/Policies/`）。
