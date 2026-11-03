# SFAD Resilience — 失敗モード + 冪等性 + 並行性

機能仕様（functional spec）を入力に、**障害耐性仕様** を独立した artifact として出力するスキル。
「正常系は動く」だけでなく「異常系・並行・リトライでも壊れない」を実装前に確定する。

## 何を防ぐか

このスキルは以下の事故を **仕様段階で** 防ぐ:

- ジョブが二重実行されてデータが破損する
- 外部 API（決済、外部解析、通知、ストレージ等）の失敗で全体が止まる
- ユーザー操作のリトライで重複データが作られる
- トランザクション境界が無く、部分失敗で孤立リソースが残る
- タイムアウトが長すぎて UX が崩れる
- 例外を握りつぶして問題が見えなくなる
- レースコンディションで unique 制約違反が突発する

## Invocation

```
/sfad resilience [feature]
/sfad resilience docs/specs/{feature}/functional.md
/sfad resilience --reverse @app/jobs/order_jobs.py
```

## 入力

- `docs/specs/{feature}/functional.md`
- `docs/specs/{feature}/threat.md`（あれば）

## Execution Flow

### Step 1: 失敗箇所の列挙

機能で発生しうる失敗箇所を全列挙する。**最低でも以下のカテゴリを必ず検討**:

| カテゴリ | 例 |
|---|---|
| 外部 API 呼び出し | 決済、外部解析、通知、ストレージなどの SaaS API |
| DB 操作 | INSERT, UPDATE, DELETE, トランザクション, unique 違反 |
| ファイル I/O | アップロード、ダウンロード、サイズ超過 |
| ジョブ / スケジューラ | リトライ、二重実行、タイムアウト |
| 並行アクセス | 同時 POST、レース、デッドロック |
| メッセージング / Webhook | 重複配信、順序逆転、配信失敗 |
| メモリ / リソース | OOM、コネクションプール枯渇 |
| ネットワーク | タイムアウト、接続切断 |

該当しないカテゴリは「該当なし」と明記。スキップ禁止。

### Step 2: Failure Modes 表の作成

各失敗箇所について、**6 列を必ず埋める**。

```markdown
## Failure Modes

| 失敗箇所 | 失敗内容 | 観測方法 | システム動作 | ユーザー体験 | 通知 |
|---|---|---|---|---|---|
| 外部解析API | API キー無し | exception (AnalysisServiceError) | parse_errors に詳細記載、200 返却、手動入力フローへ | 「画像解析できませんでした、手動入力してください」 | ログ ERROR + Sentry |
| 外部解析API | タイムアウト (15秒) | asyncio.TimeoutError | 同上 | 「解析がタイムアウトしました」 | ログ WARN |
| 外部解析API | JSON パース失敗 | JSONDecodeError | 同上 | 同上 | ログ WARN + Sentry |
| 外部解析API | 一部項目の解析失敗 | parse_errors に項目あり | 取れた分だけ返す、parse_errors を表示 | 「○件の項目が読み取れませんでした」 | ログ INFO |
| S3 アップロード | サイズ超過 | リクエスト時バリデーション | 413 返却、order レコード作らない | 「画像サイズが大きすぎます (10MB まで)」 | なし |
| S3 アップロード | アップロード失敗 | exception | 500 返却、order レコード作らない | 「アップロードに失敗しました」 | ログ ERROR + Sentry |
| 通知API (ジョブ) | 1 顧客への送信失敗 | exception | **他顧客への通知は継続** | （該当顧客のみ受信せず） | 失敗件数を最終ログに集計 |
| 通知API (ジョブ) | 全件失敗 | exception ループ後集計 | DB は更新済み、ジョブは成功扱い | （誰も受信せず） | ログ ERROR + Sentry |
| DB | unique 制約違反 | IntegrityError | early return（二重実行と判定） | 影響なし（冪等動作） | ログ INFO |
| DB | デッドロック | OperationalError | 1 回だけリトライ、それでもダメなら 500 | 「処理が混雑しています、再度お試しください」 | ログ WARN |
```

**ルール**:
- 「想定外」「未定義」禁止。書けないなら Discovery に戻る
- 各失敗について 「ログレベル」を必ず明記する（INFO / WARN / ERROR）
- 「ユーザー体験」は具体的なメッセージか挙動を書く（「エラー」だけは禁止）

### Step 3: 外部 API のタイムアウト・リトライ仕様

```markdown
## 外部 API 設定

| API | タイムアウト | リトライ | リトライ間隔 | サーキットブレーカ |
|---|---|---|---|---|
| 外部解析API | 15秒 | なし（即手動入力フロー） | N/A: リトライしない | なし |
| 通知API | 10秒 | 3 回（指数バックオフ） | 1s → 2s → 4s | あり (5分オープン) |
| S3 アップロード | 30秒 | 3 回 | 1s → 2s → 4s | なし |
| 決済 Webhook | 60秒 | 決済プロバイダ側で自動 | N/A: 自側で制御しない | N/A: 自側で制御しない |
```

**ルール**:
- 全外部 API についてタイムアウトを必ず指定する（無限待ち禁止）
- 「リトライあり」と書いたら、リトライ後の最終失敗時の挙動も明記
- 同期 API でユーザーを待たせる場合、合計待ち時間を計算する（タイムアウト × リトライ回数 ≦ 30秒目安）

### Step 4: Concurrency / Idempotency マトリクス

各 mutation エンドポイント・ジョブについて並行性と冪等性を整理。

```markdown
## Concurrency / Idempotency

| 対象 | 並行実行されうるか | 二重実行されうるか | 冪等性要件 | 実装方針 |
|---|---|---|---|---|
| ジョブ assign_order_numbers | スケジューラから 1 回のみ | リトライで 2 回ありうる | **必須** | DB unique 制約 + 冒頭で existing チェック → early return |
| ジョブ provision_notification_channel | スケジューラから 1 回のみ | リトライで 2 回ありうる | **必須** | order_group.notification_channel_id が NULL でない場合は early return |
| POST /orders | 同時 N 件ありうる | クライアントリトライで重複ありうる | **不要**（毎回新規作成） | order_number は (customer_id, order_number) unique 制約、衝突時 1 回リトライ |
| PUT /orders/{id} | 単一クライアント前提 | リトライで 2 回ありうる | **必須**（自然冪等） | upsert 方式（DELETE → INSERT は禁止、unique 違反になる） |
| DELETE /orders/{id} | 単一クライアント前提 | リトライで 2 回ありうる | **必須**（自然冪等） | 既に deleted なら 204 返却 |
```

**ルール**:
- 「冪等性必須」と書いたら、その実装方針を必ず書く
- 「並行実行されうる」と書いたら、競合対策（unique 制約 / ロック / バージョン番号）を書く
- DB 制約が必要な場合、対応する migration ファイルが Plan に含まれていることを確認
- CONC-* のテスト化は**決定的に再現できる場合のみ**行う（例: unique 制約違反を明示的に発生させる）。タイミング依存のレース検証はテスト化せず、監視・負荷試験側で扱う

### Step 5: トランザクション境界

機能で発生する **副作用の組み合わせ** を列挙し、トランザクション境界を明記する。

```markdown
## トランザクション境界

### 操作: POST /orders (画像あり)
1. S3 アップロード（外部副作用、ロールバック不可）
2. 外部解析API 解析（外部副作用、リードオンリー）
3. order レコード作成（DB トランザクション）

**境界**: S3 アップロード成功 → 外部解析API 解析 → DB 書き込み の順
**ロールバック**: DB 書き込み失敗時、S3 ファイルは残る（オーファン）→ 別途クリーンアップジョブ

### 操作: ジョブ provision_notification_channel
1. 通知チャンネル作成（外部副作用、ロールバック不可）
2. サブチャンネル A 作成（外部副作用、ロールバック不可）
3. サブチャンネル B 作成（外部副作用、ロールバック不可）
4. DB に channel_id 書き込み
5. テンプレ通知送信

**境界**: 1〜3 を連続で実行、いずれか失敗時は **直前までの通知チャンネルリソースを削除する**
**ロールバック**: try/except で部分作成リソースを delete、最後に raise
**観測**: 失敗時は Sentry に「孤立リソース疑い」を記録
```

**ルール**:
- 外部副作用（通知 API / S3 / 決済など）と DB 操作が混在する場合、ロールバック方針を必ず書く
- 「ロールバック不可」な操作の後に DB 操作する設計は再検討

### Step 6: 競合・レース対策

```markdown
## 競合 / レース対策

### POST /orders の order_number 採番

- **レース条件**: 同時 2 リクエストが同じ MAX(order_number) を読み、両方とも +1 して INSERT → unique 違反
- **対策**: `(customer_id, order_number)` に unique 制約 + IntegrityError を 1 回だけ catch して再採番
- **代替案**: SELECT ... FOR UPDATE で行ロック（パフォーマンス次第）

### ジョブ assign_order_numbers の二重実行

- **レース条件**: スケジューラがリトライで 2 回起動 → 対象レコードが 2 倍に増える
- **対策**: 冒頭で existing レコードをチェック、1 件でもあれば early return
- **DB 制約**: `(customer_id, order_group_id)` と `(order_group_id, order_number)` に unique 制約
```

### Step 7: 観測要件（APM 閾値・監視）

このセクションは**テスト生成の対象ではない**。実装後に APM（Application Performance Monitoring）で
継続監視するための閾値を記録するだけであり、**ここに書いた応答時間・スループットの閾値**からは
テストを生成しない（決定的に再現できずコードの正しさとは無関係にたまに落ちる、いわゆる
flaky テストの温床になるため）。

**PERF-* の Test List 項目とは別物**: functional.md の PERF-* は N+1 の有無をクエリ数で
検証するもので、決定的に書けるため生成対象（test.md 参照）。混同しないこと。

```markdown
## 観測要件（APM 閾値・監視）

| 操作 | 目安応答時間 | 警告閾値 | 監視方法 |
|---|---|---|---|
| GET /order-summary | 200ms | 500ms | APM ダッシュボード |
| POST /orders (画像あり) | 5秒 | 15秒 | APM ダッシュボード |
| GET /order-plan-data | 300ms | 1秒 | APM ダッシュボード + キャッシュ判定 |
| ジョブ assign_order_numbers | 5秒 | 30秒 | スケジューラログ |

**ルール**:
- 公開エンドポイントには必ずレートリミットを設定（threat.md と整合）
- 警告閾値を継続して超える場合は設計を再検討（キャッシュ / 集計テーブル / 非同期化）。
  ただしこれは運用上の対応であり、仕様確定のブロッカーにはしない
```

### Step 8: 出力の保存

`docs/specs/{feature}/resilience.md` に保存する。
functional.md の Test List に **失敗系・冪等性テスト** を自動追加する。CONC-* は決定的に再現できる場合のみ追加し、
観測要件（Step 7）からの PERF-* テスト自動生成は行わない:

```markdown
- [ ] FAIL-1: 外部解析API キー無しで POST /orders → 200 + parse_errors
- [ ] FAIL-2: 外部解析API タイムアウトで POST /orders → 200 + parse_errors
- [ ] FAIL-3: 画像サイズ超過で POST /orders → 413
- [ ] FAIL-4: ジョブで 1 顧客通知失敗 → 他顧客は継続
- [ ] IDEM-1: ジョブ assign_order_numbers を 2 回実行 → 対象レコード数が増えない
- [ ] IDEM-2: PUT /orders/{id} を 2 回実行 → 結果が同じ
- [ ] CONC-1: POST /orders を同時実行 → order_number に重複なし（unique 制約違反を明示的に起こして検証。決定的に再現できるため対象）
```

## Output

```
Resilience Modeling 完了

Failure Modes:
  カテゴリ: {N}
  失敗パターン: {M} 件
  全 6 列埋めた

外部 API:
  使用 API: {N} 件
  全 API にタイムアウト設定済み

Concurrency / Idempotency:
  対象操作: {N}
  冪等性必須: {M} 件、全実装方針記載済み

トランザクション境界:
  混在操作: {N} 件
  全ロールバック方針記載済み

観測要件（APM 閾値・監視）:
  操作: {N} 件
  警告閾値超えの既知設計: 0 件

保存先: docs/specs/{feature}/resilience.md

追加された Test List:
  FAIL-* {N} 件
  IDEM-* {N} 件
  CONC-* {N} 件（決定的に再現できるもののみ）

次のステップ:
  /sfad plan {feature}
```

## Reverse Mode（既存コード対応）

```
/sfad resilience --reverse @app/jobs/order_jobs.py
```

既存ジョブから失敗モード・冪等性の現状を抽出。**抜けている対策** を赤字で示す。
冪等性が壊れた採番ジョブのような状態を早期に発見する用途。

## ゲート

- Failure Modes 表の全列が埋まっていない → Discovery に戻る
- 「タイムアウト未指定」の外部 API がある → エラー停止
- 「冪等性必須」と書いて実装方針が無い → エラー停止
- ロールバック不可な外部副作用の後に DB 操作する設計 → 警告 + 再考要求
- 観測要件（APM 閾値）を明らかに超える設計が見えている → 警告（仕様確定のブロッカーにはしない）

このゲートを通らないと /sfad plan に進めない。
