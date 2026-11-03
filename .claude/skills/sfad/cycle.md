# SFAD Cycle — BDD Discovery + Double-Loop TDD 全自動サイクル

1コマンドで Tier 判定 → 仕様 → Double-Loop TDD を実行する薄いオーケストレーター。
各フェーズの実体はサブスキル（spec / threat / resilience / plan / test / impl）にあり、
このファイルは順序とゲートだけを定義する。

## Invocation

```
/sfad cycle [機能名]
/sfad cycle --be "ユーザー登録API"
/sfad cycle --fe "ダッシュボード画面"
/sfad cycle --pr N        # plan.md の PR #N の範囲だけ実装フェーズを実行
```

## Phase 0: Tier 判定（SKILL.md の Tier 表）

変更が触れるものを機械判定する: 認可 / 永続化スキーマ / 外部副作用 / 並行性。

- **Tier 0**（挙動変更なし）→ SFAD 対象外。通常のコミットへ
- **Tier 1** → Phase 1-2（functional.md）の後、Phase 3 へ直行
- **Tier 2** → Phase 1-2.3 をフル実行

判定結果と根拠を最初に表示し、ユーザーが上書きできる。

## Phase 1: Discovery（spec.md Step 0）

**事実の先行調査**（既存コード・スタック規約を読む。環境から分かることはユーザーに聞かない）→
Example Map のドラフト作成 → **spec-adversary agent の敵対レビュー**（穴を Questions に取り込む）→
**前提が決着した Question だけを1ラウンドにまとめ、推奨回答つきで提示** → 回答で更新 →
解禁された Question を次のラウンドへ。

**ゲート**: 未解決 Question が 0、または残りが全て Deferred（担当・期日・暫定挙動の
3点セット付き。spec.md 参照）。

## Phase 2: 機能仕様（spec.md Step 1-3 → functional.md）

Example Map を Given-When-Then + Test List に定式化し、
`docs/specs/{feature}/functional.md` に保存（frontmatter 付き）。

**ゲート**: ユーザー承認なしで先に進まない。

## Phase 2.1-2.3: 脅威・障害耐性・計画（Tier 2 のみ）

各サブスキルに委譲する。ゲート条件・手順・出力形式はサブスキル側が正:

| Phase | サブスキル | 生成物 | 主要ゲート |
|-------|-----------|--------|-----------|
| 2.1 | `/sfad threat` | threat.md | 認可マトリクス全セル埋め（空欄禁止） |
| 2.2 | `/sfad resilience` | resilience.md | Failure Modes 全埋め + 冪等性の実装方針 |
| 2.3 | `/sfad plan` | plan.md | PR 分割（1PR ≤ 1000行）+ Out of Scope 明示 |

各フェーズが Test List に項目（AUTH-* / IDOR-* / MASS-* / FAIL-* / IDEM-* / CONC-*）を追加し、
それぞれユーザー承認ゲートを持つ。

## Phase 3: 受け入れテスト（外側ループ Red）

test.md の受け入れテスト生成を実行。**Red を確認**（未実装なので当然 Red）。
このテストは xfail/skip として登録し、Phase 7 まで Red のまま寝かせる。

## Phase 4-5: UC / 状態パターンの TDD サイクル（内側ループ）

impl.md の Canon TDD サイクルを Test List の各項目（UC-N、S-N）について回す:

```
For each item in Test List:
  テスト生成 → Red 確認 → 最小実装 → Green 確認 → Refactor
  → 新発見シナリオがあれば Test List に [ADDED] で追加 → 次へ
```

進捗は `[UC-2/5] データ表示 — Red → Green (+1 [ADDED])` 形式で1行ずつ報告する。

## Phase 6: エッジケース検出

impl.md Step 6 を実行。カバレッジギャップ（境界値 / null / 並行）を提示し、
**ユーザー承認**されたものだけ Red → Green サイクルで追加。Test List に [EDGE] で追記。

## Phase 7: 受け入れテスト確認（外側ループ Green）

受け入れテストの xfail/skip を解除して実行 → **Green を確認**。
Red なら不足している内側ループを特定して追加実行。最後に全テスト実行 → 全 Green。

## Phase 7.5: 静的解析ゲート（impl.md Step 8）

プロジェクト既存の lint / format / 型チェックをエラー 0 で通過するまで修正。
**セキュリティ・レイヤ規約の write-time 検査はスタック層の hooks/CI が担当**（SFAD は重複させない）。

## Phase 8: 完成判定（機械）

```
python .claude/hooks/sfad-done.py {feature}
```

Test List 消化 / 仕様ゲート / drift / テスト Green を見て exit 0/1 を返す。
**exit 0 が出るまで完成と言わない。** 下のサマリーは判定の要約であって判定そのものではない。

## Phase 8 の出力

```
SFAD Cycle 完了: {機能名}（Tier {N}）
  仕様: docs/specs/{feature}/ — functional{ + threat + resilience + plan}
  Double-Loop: 外側 ✅ / 内側 UC ×{N} + S ×{N} + EDGE ×{N}
  Test List: {初期N} + {追加N} = {計N}/{計N} 完了
  静的解析: ✅
次: git commit（plan.md がある場合は PR #{n} の範囲でコミット）
     /sfad drift で仕様とコードの整合を確認
```

## PR スコープ実行（--pr N）

`plan.md` がある場合、`/sfad cycle --pr N` は PR #N の範囲だけ Phase 3〜7.5 を実行する:

- 仕様フェーズ（Phase 0〜2.3）と実装フェーズはセッションを分けてよい（コンテキスト経済）
- 受け入れテストは xfail/skip のまま維持し、**最終 PR で解除**する
- 各 PR の完了時に git commit をチェックポイントとして切る

## ゲート一覧

| Phase | ゲート |
|-------|--------|
| 0 | Tier 判定の提示（ユーザー上書き可） |
| 1 | Questions = 0（または全て Deferred + 3点セット） |
| 2 | functional.md 承認 |
| 2.1-2.3 | 各サブスキルのゲート + 承認（Tier 2 のみ） |
| 6 | エッジケース追加の承認 |
| 7.5 | lint / format / 型 エラー 0 |

## エラー時の振る舞い

- **Red → Green 失敗**: 分析して最大3回リトライ。3回失敗で停止し報告
- **受け入れテストが Green にならない**: 不足の内側ループを特定して追加
- **仕様の不整合を発見**: Phase 2 のゲートに戻る（仕様を直してからコードを直す）

## 手動実行との対応

```
/sfad spec       = Phase 1-2      /sfad test  = Phase 3-4 のテスト生成
/sfad threat     = Phase 2.1      /sfad impl  = Phase 4-7.5 の実装
/sfad resilience = Phase 2.2      /sfad reverse: 既存コード → 仕様（後追い）
/sfad plan       = Phase 2.3
```
