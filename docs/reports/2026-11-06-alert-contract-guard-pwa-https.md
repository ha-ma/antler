# alert-contract-guard: pwa-https（2026-11-06）

件数: Critical 0 / Warning 0 / Info 2（エージェントは読み取り専用のため、メインセッションが要約を写した）

## 確かめたこと

- AlertFlag（`server.py`）: `ssl_context` を足しただけで、送る本文は変わらない
- Capture（`capture/http.py`）: TLS の包み方を足しただけ。受け付けるキー（`{"ids"}`・`{"consent","ids"}`）と 400 の扱いは同じ。位置・識別子・氏名は入らない
- 同意済みだけを送る経路（`apps/pwa/src/features/capture/lib/send-all.ts`）は変わらない。今回は送り先の URL を決める部分だけ
- `edge-url.ts`・`capture-url.ts` はスキームとホストを決めるだけ。`t_frame`・`t_sent`・`t_shown` の扱いは変わらない
- 偽 edge は `v:1`・`t_frame`・`t_sent` を付けて送り、`ack` の `t_shown` を記録する流れのまま
- 設定ページ（`pwa_server.py`）: 4 言語がそろう。色は tokens の trip 値と一致し、3 状態の色・`#D83B1E`・絵文字を使わない。ボタンは 44px 以上
- `packages/schema`・`packages/alert-ui` は差分なし（メインセッションが `git diff --stat 0aa0bc1..HEAD -- packages/` で確認）。凍結 API の変更なし

## Info

- I-1: `AlertServer` を作る main（edge-run）がまだ無いので、wss の配線は edge-run の受け入れ基準に入れる（pwa-https の Deferred と共有メモに記録済み）
- I-2: 設定ページの CSS の色は tokens と手でそろえた値。tokens が変わったときのずれを見つけるテストが無い（次に回す）
