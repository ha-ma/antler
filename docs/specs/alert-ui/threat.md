# 脅威: alert-ui（共通スキーマと 3 状態アラート）

この feature は HTTP のエンドポイントを持たない（型・検証・表示・音のライブラリ）。誰が叩けるかの代わりに、
**誰がどのメッセージを作り、誰が読むか**を認可マトリクスにする。WebSocket のサーバーと Wi-Fi AP（B3-1 の WPA2・QR 配布）は
edge-detector の feature、記録 API（レート制限 10/分/IP）は api の feature で認可を書く。

## Authorization Matrix

| 操作                                              | edge（Mac Mini の検知）                                  | B の PWA                                                          | A のシミュレーター                          | LAN 上の別の端末                                                            | A API                                                   |
| ------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------- |
| AlertFlag を作って送る（サーバー → クライアント） | ✅                                                       | ❌ クライアントからは送れない（ClientMessage は ack・label だけ） | ✅ ゲーム内で合成（ネットワークを通らない） | N/A: WebSocket サーバーの受付と WPA2 は edge-detector の feature で検証する | N/A: API はフラグを扱わない                             |
| ack・label を送る（クライアント → サーバー）      | N/A: edge は受け取る側                                   | ✅                                                                | N/A: A はネットワークを使わない             | N/A: edge-detector の feature で検証する                                    | N/A: API はこのメッセージを扱わない                     |
| AlertFlag を読んで表示する                        | N/A: edge は表示しない                                   | ✅ readAlertFlag で形を確かめてから読む                           | ✅                                          | N/A: 表示は PWA の中だけ                                                    | N/A: API は表示しない                                   |
| Capture を作る                                    | ✅ 検知フレーム                                          | N/A: PWA は Capture を作らない                                    | ✅ 「見つけた」キャプチャ                   | N/A: この feature は保存しない                                              | N/A: 受け取って保存する側（api の feature）             |
| Capture に個人情報・精密位置を入れる              | ❌ スキーマが拒否                                        | ❌ スキーマが拒否                                                 | ❌ スキーマが拒否                           | N/A: Capture を作れない                                                     | ❌ スキーマが拒否（受信時も同じ検証）                   |
| consent:false の Capture をアップロードに回す     | ❌ アップロード対象の判定 `isUploadable` が false を返す | N/A: PWA は Capture を扱わない                                    | ❌ `isUploadable` が false を返す           | N/A: Capture を作れない                                                     | N/A: 受け取る側（api の feature で consent を確かめる） |

<!-- authz-covers: 7 packages/schema/src/authz.test.ts -->

## IDOR / Mass Assignment チェック

### ClientMessage（ack・label）

- [ ] 知らない type・余分なフィールドは拒否する（strict）。flag の形を送っても通らない
- N/A: IDOR — ID でほかの資源を指す操作が無い

### Capture

- [ ] 余分なフィールド（lat・lng・email・deviceId・name・phone など）は拒否する（additionalProperties: false）
- [ ] roadSegment は英数字とハイフンだけ（座標を書けない）
- N/A: IDOR — この feature では Capture を ID で読み書きしない（api の feature）

### TripPlan

- [ ] 余分なフィールドは拒否する。seed・riskScore・alertEnabled は型と範囲を確かめる

## Data Classification

| データ                                             | 分類                                    | 保存場所                                      | 配信方法                                      | 削除タイミング                         |
| -------------------------------------------------- | --------------------------------------- | --------------------------------------------- | --------------------------------------------- | -------------------------------------- |
| AlertFlag（deer・距離・方向・ゾーン・時刻）        | 内部（個人を特定しない）                | 保存しない（PWA は表示だけ。走行ログは edge） | LAN 内の WebSocket（ws://ezoroad.local:8765） | 表示後に破棄                           |
| AlertFlag の frameJpegB64（車外の 320px フレーム） | 内部（車外の映像。人が写りうる）        | PWA は保存しない・表示しない（B3-3）          | LAN 内の WebSocket                            | 受信後に破棄                           |
| ack の t_shown                                     | 内部                                    | edge の走行ログ                               | LAN 内の WebSocket                            | edge-detector の feature で決める      |
| Capture のフレーム画像・囲み・条件ラベル           | 教師データ（個人情報を含めない）        | 端末のローカル → 同意済みだけ dataset/        | api の feature                                | Deferred（functional.md の Questions） |
| Capture の roadSegment                             | 内部（道路区間に丸めた位置）            | Capture と同じ                                | Capture と同じ                                | Capture と同じ                         |
| TripPlan                                           | 公開（記録 URL で誰でも見られる。A7-1） | api の feature                                | api の feature                                | api の feature（A-7 の削除リンク）     |

## 認可の失効

| 失効イベント                                   | 発生源                    | 反映までの許容時間       | 反映されるまでの挙動                        | 検証          |
| ---------------------------------------------- | ------------------------- | ------------------------ | ------------------------------------------- | ------------- |
| 同意を取り消す（consent を外す）               | 利用者（A-7・B の走行後） | 次のアップロード判定まで | - その時点の consent で判定するため猶予なし | AUTH-6        |
| N/A: ログイン・ロールは無い（ch10 スコープ外） | N/A: 該当なし             | N/A: 該当なし            | N/A: 該当なし                               | N/A: 該当なし |

## 横断的セキュリティチェック

- [x] CORS: N/A（HTTP を持たない。api は init で設定済み）
- [x] レートリミット: N/A（HTTP を持たない）
- [ ] エラーメッセージ: 検証エラーの文に受け取った値そのもの（画像の base64 など）を入れない
- [ ] ログマスキング: alert-ui は frameJpegB64 をログに出さない
- [x] secrets: 扱わない
- [x] 開発バイパス: 無い
- [ ] ファイルアップロード: Capture の imageSize は正の整数、image はパス文字列だけ（中身の検証は api の feature）

## 認可テスト（functional.md の Test List に追加）

- [x] AUTH-1: PWA が flag の形をクライアント → サーバーで送ると ClientMessage の検証で拒否される
- [x] AUTH-2: edge が作る Capture に lat を入れると拒否される
- [x] AUTH-3: B の PWA が作る Capture に lng を入れると拒否される
- [x] AUTH-4: A が作る Capture に email を入れると拒否される
- [x] AUTH-5: API が受け取る Capture に deviceId があると拒否される
- [x] AUTH-6: consent:false の Capture は edge・A のどちらから来ても `isUploadable` が false（❌ 2 セル分）
- [x] MASS-1: ClientMessage・Capture・TripPlan に余分なフィールドを足すと拒否される
