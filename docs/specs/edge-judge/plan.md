# 計画: edge-judge（鹿の判定とフラグ配信）

PR は 1 つ（ブランチ `feat/edge-judge`）。合計が 1,000 行を超えない見込み（実装 約 450、テスト 約 550）。

## Implementation Plan

### PR チェーン（コミット単位）

| #   | PR タイトル                      | 含むもの                                                                                     | 行数目安 | 依存 | テスト要件                                         |
| --- | -------------------------------- | -------------------------------------------------------------------------------------------- | -------- | ---- | -------------------------------------------------- |
| 1   | feat(edge): 判定とフラグ         | `judge.py`（Judge・距離・方向）、`flag.py`（build_flag）、`config.py` に judge/server の設定 | 250      | なし | unit（UC-1・2・3・8）                              |
| 2   | feat(edge): ハブとサーバーと実行 | `hub.py`、`server.py`（websockets）、`runner.py`（pump）、pyproject に websockets            | 300      | #1   | unit・integration（UC-4〜7、AC、AUTH、FAIL、CONC） |

### 依存グラフ

```
#1 judge / flag / config ── #2 hub / server / runner
```

## このフェーズで実装すること（In Scope）

- 2 フレーム連続・1.5 秒解除の判定、距離表の補間、左右、AlertFlag の組み立てと JSON Schema での検証
- 配信の規則（変化は即時・1 秒ハートビート・新規接続へ snapshot・入力停止時の expire）
- WebSocket サーバー（パス・接続数・サイズ・ping）、ack の受信と遅延ログ
- パイプラインを別スレッドで回す `pump`
- 設定（`[judge]`・`[server]`）

## このフェーズで実装しないこと（Out of Scope）

- 二次確認 VLM（edge-vlm）、JPEG（B3-3）、Capture の保存（edge-capture）
- Wi-Fi AP・QR・mDNS・自動起動（別 feature）
- 距離表の較正（調査走行）、端末間の時計の補正
- `apps/pwa/`（別セッションが触る。この feature では編集しない）
- 起動用の CLI（AP・自動起動の feature とあわせる）

## リスクと対策

| リスク                                       | 対策                                                                                           |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| websockets のバージョン差で API が違う       | `websockets.asyncio` の新 API を使い、`>=13` を pyproject で固定。テストが実サーバーで確かめる |
| イベントループとパイプラインの重い推論が競合 | `asyncio.to_thread` で読み取りだけ別スレッド。判定・配信はループ上                             |
| テストの時間依存で不安定                     | 時計を注入。ハブはループの時間を使わず、`now` を引数で受ける                                   |
