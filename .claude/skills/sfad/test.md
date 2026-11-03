# SFAD Test — 受け入れテスト + UC テスト生成

仕様（`docs/specs/{feature}/functional.md`）からテストコードを生成する。
Double-Loop の構造（外側=受け入れ / 内側=UC）は SKILL.md の図が正。

**一括生成の範囲**: 受け入れテスト（外側ループ）は最初に一括生成する。UC など内側の項目は
Test List の1項目ずつ生成し、その都度 Red → 最小実装 → Green を回す（`/sfad cycle` Phase 4-5）。
全項目の一括生成は、既に実装があるとき（`/sfad reverse` 後など）と、ユーザーが明示的に
要求したときだけ。実装を理解する前にテスト構造を固定しないための線引き。

## Invocation

```
/sfad test                              # 受け入れ + 全UCテストを生成
/sfad test UC-1 [UC-2 ...]              # 指定 UC のみ
/sfad test @docs/specs/{feature}/functional.md
/sfad test --acceptance-only
/sfad test --be | --fe                  # スタック判定の強制
```

## Step 1: 仕様の読み込み

functional.md から Example Map / UC-N / S-N / Test List を抽出し、BE/FE を判定する。

**Test List の接頭辞を全て認識する**（Step 5 の突合対象）:

| 接頭辞 | 生成元 | 内容 |
|--------|--------|------|
| UC-* / S-* | functional.md | ユースケース / 状態パターン |
| ERR-* | functional.md | エラーパターン（401/403/404/422） |
| PERF-* | functional.md | N+1 検証（決定的に書けるもののみ） |
| AUTH-* / IDOR-* / MASS-* | threat.md | 認可・アクセス制御・失効（Tier 2） |
| AUDIT-* | threat.md | 特権操作が監査記録に残る（Tier 2） |
| MIGR-* | plan.md | マイグレーションの downgrade が通る（スキーマ変更を含む場合） |
| FAIL-* / IDEM-* / CONC-* | resilience.md | 失敗モード・冪等性・並行性（Tier 2） |
| ADDED / EDGE | 実装中 | 実装中に発見して追加した分（Canon TDD の「リストを育てる」） |

## Step 2: テストツール選定

1. **既存テスト設定を最優先**（プロジェクトの設定・書き方を踏襲）
2. なければ SKILL.md のスタック検出表のツールを使う
3. **モック方針・テストの書き方はスタック層が正**（`stacks/{stack}/docs/architecture.md`「テスト戦略の考え方」。所在の一覧は `CONTRACT.md`）。
   共通原則: 境界（HTTP/外部依存）はスタブで隔離した solitary テスト、
   ドメインロジックは状態検証（モック最小限）

## Step 3: 受け入れテスト生成（外側ループ）

機能全体を検証する統合レベルのテスト。**最初に書いて、最後まで Red が正常。**
`/sfad cycle` 実行時は xfail/skip 登録して寝かせ、Phase 7 で解除する。

- FE: `{feature}.acceptance.test.{ext}` — 正常表示 / 主要操作フロー / エラー・空・ローディング
- BE: `test_{feature}_acceptance.{ext}` — 正常レスポンス / 認証なし 401 / バリデーション 422

## Step 4: UC テスト生成（内側ループ）

```
UC-N          → テストグループ 'UC-N: {名前}'
  Given       →   セットアップ / スタブ設定
  When        →   操作実行
  Then        →   アサーション
  Examples    →   1 Example = 1 テストケース
S-N           → テストグループ 'S-N: {状態名}'
```

**共通ルール**:
1. **トレーサビリティ必須**: ファイル冒頭に仕様との対応マップ
2. テストグループ名は `'UC-N: ...'` / `'S-N: ...'` 形式
3. 実装詳細ではなく振る舞いを検証する
4. テスト名と検証内容を一致させる（名前と中身のズレは仕様の誤解を生む）
5. **モック対象のシグネチャは実装コードを読んで確認**（推測でモック名を書かない）

**PERF-N（N+1 防止）**: クエリ数がデータ量に依存しないことをカウントで検証
（N=1 と N=50 でクエリ数が同じ）。決定的に書けるテストのみ生成する。
その他の性能要件は仕様の「観測要件」であり、テスト化しない。

### トレーサビリティコメント

```
/** @spec docs/specs/{feature}/functional.md
 *  @coverage UC-1 → describe('UC-1: ...') / S-1 → describe('S-1: ...') */
```

（Python は docstring で同形式）

## Step 5: Test List との整合確認

Test List の**全接頭辞の全項目**に対応するテストが存在するか突合し、
不足があれば提示して追加生成する。

Tier 2 では **threat.md の ❌ セル数と AUTH-* の件数**も突合する（threat.md のゲート参照）。
この突合は `/sfad drift` の COVERAGE GAP が CI でも機械的に再検査する — トレーサビリティ
コメントの識別子が実在するテストに現れているかを見るので、`@spec` / `@coverage` は必須。

## Step 6: 実行と Red 確認

生成 → 実行 → 受け入れ・UC とも Red を確認し、理由を表示する。

## Output

```
テスト生成完了
  検出スタック: {言語/フレームワーク} → {ツール}
  受け入れ: {N} cases（Red — 最後に Green になる）
  UC/S/その他: {N} cases（1つずつ Green にする）
  Test List 突合: {N}/{N}（ギャップなし）
次: /sfad impl
```
