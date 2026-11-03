# SFAD Spec — BDD Discovery + Formulation

BDD の Discovery（発見）と Formulation（定式化）を実行し、`docs/specs/{feature}/functional.md` を生成する。

## Invocation

```
/sfad spec お問い合わせ一覧
/sfad spec --be "ユーザー登録API"
/sfad spec --fe "ダッシュボード画面"
```

## Step 0: Discovery — 事実の先行調査 + Example Mapping

**出典**: Matt Wynne の Example Mapping。Three Amigos を AI が担い、ユーザーは質問に答える。

```
Story（黄）: ユーザーとして、お問い合わせ一覧を見たい
  ├── Rule（青）: 一覧はページネーションされる
  │     ├── Example（緑）: 20件以下 → ページネーションなし
  │     └── Example（緑）: 21件以上 → 1ページ目がデフォルト表示
  ├── Rule（青）: データ取得に失敗した場合はエラーを表示する
  │     └── Example（緑）: API 500 → 「データの取得に失敗しました」
  └── Question（赤）: ソート機能は必要か？
```

### AI の視点（ドラフト作成時に必ず全部使う）

1. **PO 視点（ビジネス価値）**: 主な利用者は誰か / 最重要ルールは何か / 使えないときユーザーはどうするか
2. **Dev 視点（技術制約）**: 既存の類似機能とパターン / 外部依存（API・DB・サービス） / データ量とレスポンス目標
3. **QA 視点（エッジケース）**: 0件のとき / 同時に2人が操作したら / 不正な入力（空・超長・特殊文字） / 境界値（0件・1件・最大）

**攻撃者視点（認可・IDOR・Mass Assignment 等）は `threat.md` の管轄**（Tier 2 で `/sfad threat` が
認可マトリクスとして網羅する）。Discovery では「認証が必要か・誰が使うか」だけ確認すればよい。

### 進め方

1. **事実の先行調査**: 既存コード・類似機能・スタックの規約（`stacks/{stack}` の docs / skills）を
   **ドラフト作成より先に**読む。**環境から分かることをユーザーに聞かない** — 調べるのは AI の仕事、
   決めるのはユーザーの仕事。調査は待たずに走らせ、その結果に依存する Question だけ後続ラウンドへ回す
2. 機能名から Example Map のドラフトを AI が作成（Story + Rules + Examples + Questions）
3. **敵対レビュー**: `spec-adversary` agent（読み取り専用・クリーンな文脈）にドラフトを
   レビューさせ、穴（不足 Example / 未定義の振る舞い / 甘い仮定）を Questions に取り込む。
   自分の仕様は自分に甘い — 独立した目を必ず通す
4. **ラウンドで聞く**: Question を依存関係で並べ、**前提が既に決着したものだけ**を1ラウンドに
   まとめて提示する。各質問に番号・見出し・**推奨回答**を必ず添える（ユーザーが「全部それで」で
   終われるように）。他の未解決 Question に答えが依存する質問は、このラウンドではなく次のラウンドのもの

   ```
   ❓ Q1 — {質問の見出し}: {質問本文。選択肢があれば列挙}
   ➡️ 推奨: {AI の推奨回答と根拠}
   ```

5. 回答で Example Map を更新 → 決着した決定が次の Question を解禁する。
   **出せる Question が無くなるまで**ラウンドを繰り返す。
   終了は「列挙した分に答えた」ではなく「**枝が残っていない**」こと
6. **今すぐ答えられない Question は Deferred にできる**（ラウンドを止めないための逃げ道）:

   ```
   - [Deferred: 担当={誰の知識が必要か} / 期日={いつまでに} / 暫定挙動={それまでの振る舞い}] {質問}
   ```

   Deferred には3点セット（担当・期日・暫定挙動）が必須。暫定挙動は仕様として実装・テスト
   され、期日は Question の消滅ではなく**確認の締切**を意味する。
   ゲート条件: **未解決 Question が 0、または残りが全て Deferred（3点セット付き）**

## Step 1: Formulation — Given-When-Then への変換

**変換ルール**:
- 1 Rule = 1 UC（ユースケース）
- 1 Example = 1 テストケース
- Question が残っていたら変換しない（Discovery に戻る）

Tier 2 では **Rule → ドメイン語彙対応**（橋）も記入する — Discovery の Rule が
どの Policy / Rules / ValueObject としてコードに着地するかの1対1対応。
`/sfad drift` が実在を機械検査する。

テンプレートは references が唯一の正（`/sfad reverse` も同じものを使う）:

- FE: `references/spec-template-fe.md`
- BE: `references/spec-template-be.md`

| パターン | 典型的な Rules |
|---------|--------------|
| 一覧画面 | データ表示、ページネーション、行クリック遷移、検索/フィルタ |
| 詳細画面 | データ表示、関連データ、編集リンク |
| フォーム | バリデーション、送信、エラー表示、成功遷移 |
| CRUD API | 作成/読取/更新/削除 × 認証/バリデーション |
| 外部連携 | 正常/タイムアウト/リトライ/フォールバック（詳細は resilience.md） |

## Step 2: 仕様のレビュー（ユーザー承認ゲート）

提示して確認する観点:
- Rule に漏れはないか / 各 Rule に Example が2つ以上あるか
- Test List に境界値（0件・1件・最大）と敵対的入力が含まれるか
- 非機能要件が受け入れ基準に含まれるか

承認を得て確定。**承認なしで Step 3 に進まない。**

## Step 3: 保存

```
docs/specs/{feature}/functional.md
```

frontmatter（feature / target_paths / spec_confirmed_at=現在のコミットSHA / tier）を記入して保存。
このファイルが `/sfad test` の入力であり、drift 検出の錨になる。

## Output

```
仕様定義完了
  Example Map: Rules {N} / Examples {N} / Questions 0（Deferred {N} 件）
  保存先: docs/specs/{feature}/functional.md（Tier {1|2}）
  Test List: {N} 項目

次: /sfad test（Tier 2 なら先に /sfad threat → /sfad resilience → /sfad plan）
```
