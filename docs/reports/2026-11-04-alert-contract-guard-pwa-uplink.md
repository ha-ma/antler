# alert-contract-guard: pwa-uplink（2026-11-04）

結果: **Critical 0 / Warning 2 / Info 5**（agent は読み取り専用のため、要約をメインセッションが保存）。

- ClientMessage への `vehicle` 追加は追加だけ。ack・label の定義は main と同一、`client-message.schema.json` の増分は `vehicle` の枝（35 行）だけ。他 4 つの JSON Schema は行数一致。
- `vehicle` は strict で、位置・精度・時刻・端末識別子の席が無い。PWA から出るのは `speedKmh` / `zone` / `light` だけ。
- edge の hub/fusion は `detector.l1` を import しない（サブプロセスのテストあり）。
- `calibration.json` の `context` は任意で、無ければ `fixed`。値違いは校正なし（降格しない側）。

| 指摘                                                                                 | 重大度  | 決着                                                                                                                                    |
| ------------------------------------------------------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| W-1 ch7 の原本が ack と label だけと書いている                                       | Warning | `docs/changes/2026-11-04-pwa-uplink.md` が暫定の正。PR に「凍結 API への追加（推奨で決定）」と書く。原本（Claude Docs）の修正は人の作業 |
| W-2 再描画のたびに effect が走り、間引き境界で束になりうる                           | Warning | 0.9 秒の間引き（EdgeClient）で 1 秒に 1〜2 通。edge の 5 通/秒の内側。DriveUplink.test.tsx が再描画込みで ≤3 通/2 秒を確認              |
| I-1 `on_client_message` の docstring が ack・label のまま                            | Info    | 直した                                                                                                                                  |
| I-2 `zone` の列挙が client-message と judge-request で別々                           | Info    | 後回し（Zone を common.ts に置く）                                                                                                      |
| I-3 `context` の綴り違いで校正全体が落ちる／`calibrate.py` が再学習で context を消す | Info    | 安全側。Deferred の `--context` と合わせる                                                                                              |
| I-4 空の `vehicle` を 2 台目が送ると実値が固定値に戻る                               | Info    | PWA は空を送らない                                                                                                                      |
| I-5 契約を守るテストは足りている                                                     | Info    | —                                                                                                                                       |

未確認（agent 側）: テストの実行、main とのバイト差分。メインセッションが全テストを実行して通っている。
