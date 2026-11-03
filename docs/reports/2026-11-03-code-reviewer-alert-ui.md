# code-reviewer: alert-ui（2026-11-03）

対象: packages/schema・packages/alert-ui・edge の契約テスト。エージェントはファイルを読んでの確認のみ（テストは実行していない）。

## Critical（直した）

| 内容                                                                                                                                                      | 直し方                                                                    | テスト |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------ |
| `applyDanger` が消音・解除前で return する前に読み上げの数え直しをしないため、読み上げ済みの danger → zone → 消音の danger → 消音解除で読み上げが鳴らない | 新しい danger の判定と数え直しを audible の判定より前に                   | CONC-2 |
| `failed` が戻らず、unlock をやり直しても canPlay が false のまま                                                                                          | 失敗時に `unlocking` を空にし、unlock 成功で `failed=false`               | FAIL-6 |
| `WebAudioPort.unlock` が同期で例外を投げ、呼び出し元（B-0 のタップ）に漏れる                                                                              | `async unlock()`。コントローラ側も `Promise.resolve().then(...)` で受ける | FAIL-7 |

## Warning

| 内容                                                                        | 扱い                                                                                                                   |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 同じ要素で role を status / alert に切り替え                                | 直した（accessibility-checker の Critical と同じ。UC-10d）                                                             |
| 言語が変わっても読み上げ文が変わらない。距離が無いと「-- メートル」と読む   | 直した（UC-10f）                                                                                                       |
| unmount の後始末が無く、外れた後もビープが鳴る。danger が解けても発話が残る | `release()` を足し、AlertState の unmount で呼ぶ。danger が解けたら発話を止める（UC-5l・FAIL-8）                       |
| `unrepresentable:'any'` は将来の transform などを黙って「何でも通す」にする | 既定（throw）に戻した                                                                                                  |
| Zod の正規表現と Python の挙動の差（`\d`・末尾の `$`）                      | JSON Schema の書き出しで `portablePattern` をかけ、全角数字・末尾改行の見本を追加（UC-1k）                             |
| チャイムの再入場抑止が `Date.now()` 直で、時計が戻ると黙る                  | 時計が戻ったら鳴らす側に倒した（注入はしない）                                                                         |
| exactOptionalPropertyTypes の `\| undefined` の不統一                       | GpsZone・DerivedAlert・AlertStateProps に揃えた                                                                        |
| `type:'flag'` で deer が真偽値でないと null（危険側に倒していない）         | **そのまま**。deer が読めないものを danger にすると、壊れたハートビートで赤が出続ける。edge の送信側の契約テストで防ぐ |
| distanceM に上限が無く「1e+21」と出る                                       | 表示側で 10,000 以上を「--」に（UC-12c）                                                                               |

## Info

- 良い点: useBlink の後片付け、4 通りの union と JSON Schema の anyOf の整合、readAlertFlag が undefined を代入しない
- `deriveAlertState` の 5 秒後の再評価のタイマーは消費側（PWA）に要る。pwa-drive の feature の Test List に入れる
