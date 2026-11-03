# 脅威: schema-judge（JudgeRequest・AlertFlag.l1・Capture.l1Probs）

この feature は HTTP のエンドポイントを持たない（型・検証・生成物だけ）。誰が叩けるかの代わりに、
**誰がどのメッセージを作り、何を入れられないか**を認可マトリクスにする。L1 サーバー（local-jev）の待ち受け（127.0.0.1 だけ）、
タイムアウト、`typesafe-sdk` の呼び出しは edge-l1 の feature、WebSocket と Wi-Fi は edge-detector の feature、アップロード API は api の feature で認可を書く。

## Authorization Matrix

| 操作                                                         | edge（L0 が JudgeRequest を作る）                 | local-jev（Mac mini 内の L1 サーバー）          | B の PWA                                                          | A のシミュレーター・dataset（校正ラベル）           | LAN 上の別の端末                                            | A API                                                   |
| ------------------------------------------------------------ | ------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| JudgeRequest を作る                                          | ✅ L0 の状態から                                  | N/A: 受け取って応答する側（edge-l1 の feature） | N/A: PWA は L1 を呼ばない                                         | ✅ 校正用に正解つきで作る（ネットワークに出さない） | N/A: 待ち受けは 127.0.0.1 だけ（edge-l1 の feature で検証） | N/A: API は L1 を扱わない                               |
| JudgeRequest に画像（frameJpegB64 など）を入れる             | ❌ スキーマが拒否（strict）                       | N/A: 作る側ではない                             | N/A: 作れない                                                     | ❌ スキーマが拒否                                   | N/A: 作れない                                               | N/A: 扱わない                                           |
| JudgeRequest に位置（lat・lng）・端末識別子を入れる          | ❌ スキーマが拒否（strict）                       | N/A: 作る側ではない                             | N/A: 作れない                                                     | ❌ スキーマが拒否                                   | N/A: 作れない                                               | N/A: 扱わない                                           |
| JudgeRequest の質問文・順序・件数を書き換える                | ❌ 固定の 4 問以外は拒否                          | N/A: 作る側ではない                             | N/A: 作れない                                                     | ❌ 固定の 4 問以外は拒否                            | N/A: 作れない                                               | N/A: 扱わない                                           |
| AlertFlag に l1 を付けて送る（サーバー → クライアント）      | ✅ 任意。L1 の結果があるとき                      | N/A: フラグを作らない                           | ❌ クライアントからは送れない（ClientMessage は ack・label だけ） | N/A: A のゲーム内の合成に L1 は無い                 | N/A: WebSocket の受付は edge-detector の feature で検証する | N/A: API はフラグを扱わない                             |
| l1 を読んで PWA の表示を変える                               | N/A: edge は表示しない                            | N/A: 表示しない                                 | ❌ readAlertFlag は l1 を返さない（表示は l1 に左右されない）     | N/A: A は l1 を読まない                             | N/A: 表示は PWA の中だけ                                    | N/A: API は表示しない                                   |
| Capture に l1Probs を付ける                                  | ✅ 任意。L1 の probabilities をソフトラベルとして | N/A: Capture を作らない                         | N/A: PWA は Capture を作らない                                    | N/A: A の Capture に L1 は無い                      | N/A: Capture を作れない                                     | N/A: 受け取って保存する側（api の feature）             |
| Capture の l1Probs に位置・識別子などの余分なキーを入れる    | ❌ スキーマが拒否（strict）                       | N/A: Capture を作らない                         | N/A: Capture を作らない                                           | ❌ スキーマが拒否                                   | N/A: Capture を作れない                                     | ❌ スキーマが拒否（受信時も同じ検証）                   |
| l1Probs つきで consent:false の Capture をアップロードに回す | ❌ isUploadable が false を返す                   | N/A: Capture を作らない                         | N/A: PWA は Capture を扱わない                                    | ❌ isUploadable が false を返す                     | N/A: Capture を作れない                                     | N/A: 受け取る側（api の feature で consent を確かめる） |

<!-- authz-covers: 13 packages/schema/src/judge-authz.test.ts -->

## IDOR / Mass Assignment チェック

### JudgeRequest

- [ ] 余分なフィールドは拒否する（トップレベル・`state`・`track` の各点・各質問が strict）。画像・位置・識別子を足せない
- [ ] `model` は英数字と `.` `_` `:` `-` だけの 64 字までの文字列（改行・空白を入れられない）。値の意味（どのモデルか）は edge-l1 が設定で決め、この feature は形だけ確かめる
- N/A: IDOR — ID でほかの資源を指す操作が無い

### AlertFlag.l1

- [ ] `l1` は 4 つのキーだけ（strict）。余分なキーは拒否する
- N/A: IDOR — ID でほかの資源を指す操作が無い

### Capture.l1Probs

- [ ] `l1Probs` は 4 つの質問のキーだけ（strict）。`alert_level` も 3 つの値だけ。位置・識別子・自由文を運べない
- N/A: IDOR — この feature では Capture を ID で読み書きしない（api の feature）

## Data Classification

| データ                                                 | 分類                                                 | 保存場所                                                    | 配信方法                                            | 削除タイミング                                    |
| ------------------------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------- |
| JudgeRequest の state（速度・ゾーン・光・track・TTC）  | 内部（個人を特定しない。画像・位置を含めない）       | edge の走行ログ（保存するかは edge-l1 の feature で決める） | Mac mini 内の HTTP（127.0.0.1。edge-l1 の feature） | edge の走行ログの方針に従う（Deferred）           |
| JudgeRequest の質問文（固定）                          | 公開（リポジトリに書いてある固定の英文）             | リポジトリ                                                  | リポジトリ                                          | N/A: 固定の文言で個人の情報を含まない             |
| JudgeRequest の model（設定値の文字列）                | 内部                                                 | edge の設定ファイル                                         | 同上                                                | 設定の変更時                                      |
| AlertFlag.l1（alert_level・conf・overrode・latencyMs） | 内部（個人を特定しない）                             | 保存しない（PWA は読まない。走行ログは edge）               | LAN 内の WebSocket（ws://ezoroad.local:8765）       | 表示後に破棄（PWA は読まない）                    |
| Capture.l1Probs（質問ごとの確率）                      | 教師データ（個人情報を含めない。Capture と同じ扱い） | 端末のローカル → 同意済みだけ dataset/                      | api の feature                                      | Capture と同じ（Deferred。alert-ui の Questions） |

## 認可の失効

| 失効イベント                                   | 発生源                    | 反映までの許容時間       | 反映されるまでの挙動                                            | 検証          |
| ---------------------------------------------- | ------------------------- | ------------------------ | --------------------------------------------------------------- | ------------- |
| 同意を取り消す（consent を外す）               | 利用者（A-7・B の走行後） | 次のアップロード判定まで | - l1Probs があっても、その時点の consent で判定するため猶予なし | AUTH-8        |
| N/A: ログイン・ロールは無い（ch10 スコープ外） | N/A: 該当なし             | N/A: 該当なし            | N/A: 該当なし                                                   | N/A: 該当なし |

## 横断的セキュリティチェック

- [x] CORS: N/A（HTTP を持たない）
- [x] レートリミット: N/A（HTTP を持たない。L1 の呼び出し頻度は edge-l1 の設定 `rate_hz`）
- [ ] エラーメッセージ: 検証エラーの文に受け取った値そのものを入れない（Python の `ValidationError` を握りつぶさずログに出すときも本文を出さない）
- [ ] ログマスキング: JudgeRequest の本文は、保存・ログに出すかを edge-l1 の feature で決める（この feature は形だけ）
- [x] secrets: 扱わない（`TYPESAFE_BASE_URL` は URL で、キーを含めない。edge-l1 の feature）
- [x] 開発バイパス: 無い
- [ ] ファイルアップロード: N/A に近い。Capture の `image` は従来どおりパス文字列だけ（変更なし）

## 認可テスト（functional.md の Test List に追加）

- [x] AUTH-1: JudgeRequest の `state` に frameJpegB64 を入れると拒否される（edge・A/dataset の ❌ 2 セル分）
- [x] AUTH-2: JudgeRequest の `state` に lat・lng・deviceId を入れると拒否される（❌ 2 セル分）
- [x] AUTH-3: JudgeRequest の質問文・順序・件数を変えると拒否される（❌ 2 セル分）
- [x] AUTH-4: PWA が l1 つきの flag の形をクライアント → サーバーで送ると ClientMessage の検証で拒否される
- [x] AUTH-5: `readAlertFlag` は l1 つきでも l1 を返さない（PWA の表示の入力に l1 が無い）
- [x] AUTH-6: edge・A が作る Capture の `l1Probs` に lat などの余分なキーを入れると拒否される（❌ 2 セル分）
- [x] AUTH-7: API が受け取る Capture の `l1Probs` に deviceId があると拒否される
- [x] AUTH-8: consent:false の Capture は `l1Probs` つきでも edge・A のどちらから来ても `isUploadable` が false（❌ 2 セル分）
- [x] MASS-1: JudgeRequest・`l1`・`l1Probs` に余分なフィールドを足すと拒否される
