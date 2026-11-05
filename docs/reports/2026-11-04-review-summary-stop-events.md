# stop-events のレビューのまとめ（2026-11-04）

5 つのレビューの全文は同じフォルダの `2026-11-04-{code-reviewer,component-guard,accessibility-checker,security-auditor}-stop-events.md`。layer-guard は返答だけ（下に要約）。

| レビュー              | Critical | 直したもの                                                                                                                                                                              |
| --------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| code-reviewer         | 0        | W1 文の検証で「一時的」「有一點」を時刻と見なさない／W2 アラートを切り替えても seq が戻らない／W3 409 の待ち直しを 100 秒に                                                             |
| layer-guard           | 0        | runId の正規化を Route から zod の transform に                                                                                                                                         |
| component-guard       | 0        | W1（code-reviewer W2 と同じ）／W3 翌日の時刻の式を utils/format の timeOfDay にまとめた                                                                                                 |
| accessibility-checker | 4 → 0    | 画面より高いと上が切れる → dialog の margin: auto／閉じたらフォーカスを戻す／Esc・Tab をダイアログ全体で（portal と背面の inert）／lang 属性。見出しを h2 に、写真の点を aria-hidden に |
| security-auditor      | 0        | なし（Warning は下）                                                                                                                                                                    |

実機（api 8801・sim 5191、本物の Claude）で見つけて直したもの: イベントの `at` が分までの時刻（束の時刻の形）だと 400 になっていた → `@antler/schema` の IsoDateTime で受ける。

## 次に回す Warning

- security W1: failed の束は待ち時間なしで作り直せるので、所有者が失敗を繰り返すと 1 日の上限（plan-trip と共有）を削れる。冷却時間か失敗回数の上限を置く
- security W2: 1 日の Claude の枠は plan-trip と共有で取り分が無い。旅の作成が先に止まらないよう、stop-events の取り分か旅ごとの上限を考える
- security W3 / code-reviewer W5: イベントの上限・重複の数え方は同時の POST でわずかにずれる（データは壊れない）
- security Info: events は JSON の検証が所有者の照合より先。zod の知らないキー名がログに入る（issues の切り詰め）
- code-reviewer W4: choice の解決が重複判定より先。束が作り直された後の再送は 400 になりうる
- component-guard W2: StopScenesPage の choose をフックか純関数に分ける。Info: event-sender を useMutation に、lang・date の 3 段渡し、ownerTokenOf を shared へ
- accessibility Warning: ボタンの名前が長い、非 primary の枠が薄い（1.2:1）、スマホ横で lead と note を隠す、status 領域が内容と同時に入る、選択肢 0 件の出口
- layer-guard Warning: application が @antler/trip・@antler/zones を直接 import（ワークスペースの純粋パッケージなので許容）、PENDING_STALE の判定を policy へ
