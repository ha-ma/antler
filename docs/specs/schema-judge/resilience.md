# 障害耐性: schema-judge（JudgeRequest・AlertFlag.l1・Capture.l1Probs）

方針（ch6「B 誤検知」）: **契約の型が赤の経路を止めない。** `l1` は任意で PWA は読まないので、`l1` が壊れていても・古い PWA が知らなくても、
`deer` の判定と表示は変わらない（`readAlertFlag` が deer を最優先で読む）。JudgeRequest は L1 の入力で、赤の経路に入らない（B2-3）。
この feature の失敗は「3 つの形の食い違い」と「生成物の古さ」が中心で、実行時の失敗は edge-l1 の feature が扱う。

## Failure Modes

| 失敗箇所            | 失敗内容                                                     | 観測方法                                          | システム動作                                                                                 | ユーザー体験                         | 通知                                                              |
| ------------------- | ------------------------------------------------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------- |
| 定義の変更          | Zod を直したが JSON Schema を書き出し直していない            | UC-5a のテストが落ちる                            | CI（local-ci）が失敗し、push・マージできない                                                 | なし（開発時に止まる）               | CI の失敗                                                         |
| 定義の変更          | JSON Schema を直したが pydantic を作り直していない           | UC-6a のテストが落ちる                            | 同上                                                                                         | なし（開発時に止まる）               | CI の失敗                                                         |
| 生成ツール          | `datamodel-code-generator` のバージョン差で出力が変わる      | UC-6a のテストが落ちる                            | バージョンを固定してあり、上げるときは生成し直した差分を PR で確かめる                       | なし（開発時に止まる）               | CI の失敗                                                         |
| pydantic の正規表現 | `pos` の `$` の扱いが Python と JS で違い、末尾の改行が通る  | UC-1e の見本（末尾の改行つき）が 3 つで一致しない | JSON Schema は `(?!\n)$` に直してある。pydantic は `regex_engine='python-re'` で同じ式を読む | なし（開発時に止まる）               | CI の失敗                                                         |
| 数値                | Python が NaN・Infinity を JudgeRequest に入れる             | UC-1i・UC-6e のテスト                             | pydantic が `allow_inf_nan=False` で拒否し、L1 に送らない（L0 単独で動く）                   | なし（赤は L0 で鳴る）               | 呼び出し側（edge-l1）が `l1_unavailable` をログ                   |
| フラグの受信        | 古い PWA が `l1` つきの flag を受け取る（`l1` を知らない版） | 厳しい検証が「余分なキー」で落ちる                | ゆるい読み取りで deer・距離・方向を読む（`problem: partial`）                                | 変化なし（赤・琥珀・緑は従来どおり） | logger.warn（`flag.partial`。本文は入れない）                     |
| フラグの受信        | `l1` の中身が壊れている（conf が範囲外など）                 | `readAlertFlag` が `l1` を除いて検証する          | `l1` は無視し、ほかの欄で strict を判定する。壊れた deer:false でも赤を解ける                | 変化なし（赤が解けないことはない）   | なし（`l1` は PWA が読まない。edge のログで見る）                 |
| フラグの送信        | edge が `l1` に NaN を入れて `json.dumps` する               | JSON.parse が失敗（`flag.invalid`）               | そのフラグは丸ごと捨てられる（deer:true も）。edge は `allow_nan=False` で送る               | 赤が出ない恐れ                       | edge-l1 の feature で防ぐ（`l1` の数は 0〜1・0 以上に絞ってある） |
| Capture の検証      | `l1Probs` が壊れている（範囲外・余分なキー）                 | `CaptureSchema` が拒否                            | その Capture は保存・アップロードに回さない（isUploadable が false）                         | 走行後の同意済みデータから漏れる     | 保存側（edge・api の feature）でログ                              |
| index.ts の統合     | plan-trip の `TripDetails` の export と衝突する              | マージ時の衝突・UC-5d のテスト                    | 両方の export を残して解く。UC-5d が既存の export の消失を検出する                           | なし                                 | PR のレビュー                                                     |
| 質問文の書き換え    | 片方の側（TS か Python）だけ質問文を直す                     | UC-2d・UC-6d のテスト                             | 原本の例（見本）と一致しなければ落ちる。校正データの無効化を防ぐ                             | なし（開発時に止まる）               | CI の失敗                                                         |

## 外部 API 設定

| API                                              | タイムアウト                              | リトライ                | リトライ間隔            | サーキットブレーカ                           |
| ------------------------------------------------ | ----------------------------------------- | ----------------------- | ----------------------- | -------------------------------------------- |
| datamodel-code-generator（ローカルの開発ツール） | N/A: 外部サービスではない（ローカル実行） | なし                    | N/A: リトライしない     | N/A: 外部サービスではない                    |
| local-jev（`/v1/systemone`）                     | N/A: 呼び出しは edge-l1 の feature        | N/A: edge-l1 の feature | N/A: edge-l1 の feature | N/A: edge-l1 の feature（L0 単独運転に縮退） |

## Concurrency / Idempotency

| 対象                                  | 並行実行されうるか                                    | 二重実行されうるか | 冪等性要件                                | 実装方針                                                           |
| ------------------------------------- | ----------------------------------------------------- | ------------------ | ----------------------------------------- | ------------------------------------------------------------------ |
| JSON Schema の書き出し（build:json）  | 並行セッションが同じファイルを書きうる                | ありうる           | **必須**（同じ入力 → 同じバイト列）       | 定義だけから決まる。時刻・乱数を入れない。既存の仕組みのまま       |
| pydantic の生成（generate_models.py） | 同上                                                  | ありうる           | **必須**（同じ入力 → 同じバイト列）       | `--disable-timestamp`。ツールのバージョン固定。出力先は 1 ファイル |
| 検証関数（Zod・jsonschema・pydantic） | 受信のたびに何度も呼ばれる                            | 同じ入力で何度も   | **必須**（純粋）                          | 状態を持たない                                                     |
| `index.ts` と `pyproject.toml` の編集 | plan-trip と edge-l0 のセッションが同じファイルを編集 | ありうる           | N/A: 冪等性の対象ではない（マージの衝突） | 追記だけにして、マージで両方を残す                                 |

## トランザクション境界

N/A: 永続化しない（Capture の保存は api と edge の feature）。

## 障害テスト（functional.md の Test List に追加）

- [x] FAIL-1: 壊れた `l1` つきの deer:false を `readAlertFlag` に通すと `strict: true`（PWA が捨てず、赤を解ける）。壊れた `l1` つきの deer:true は deer・距離・方向を読める
- [x] FAIL-2: `pos` に末尾の改行がある JudgeRequest は、Zod・jsonschema・pydantic の 3 つで拒否される
- [x] FAIL-3: Python で NaN・Infinity を `speedKmh`・`lateralMps`・`ttcSec` に入れると pydantic が拒否する
- [x] FAIL-4: 壊れた `l1Probs` を持つ Capture は `isUploadable` が false
- [x] IDEM-1: JSON Schema の書き出しを 2 回繰り返しても同じバイト列（`renderJsonSchema` を 2 回呼んで比べる）
- [x] IDEM-2: pydantic の生成を 2 回繰り返しても同じバイト列
