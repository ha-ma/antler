# 計画: pwa-uplink（PWA → edge の速度・ゾーン・光）

PR は 1 つ（ブランチ `feat/pwa-uplink`、base は main）。実装 約 450 行、テスト 約 900 行の見込み。契約（schema）・edge・PWA の 3 つが揃って初めて受け入れ (a)〜(c) が通るので分けない。コミットを分けて読みやすくする。

## Implementation Plan

### PR チェーン（コミット単位）

| #   | コミット                                 | 含むもの                                                                                                                                                             | 行数目安 | 依存   | テスト要件                                 |
| --- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ | ------------------------------------------ |
| 1   | docs(spec): pwa-uplink                   | functional / threat / resilience / plan、`docs/changes/2026-11-04-pwa-uplink.md`                                                                                     | 450      | なし   | なし                                       |
| 2   | feat(schema): ClientMessage に vehicle   | `client-message.ts`（追加だけ）、見本、JSON Schema の再生成、`generate_models.py` の複数対応と `client_message.py`                                                   | 250      | #1     | unit（VM）                                 |
| 3   | feat(edge): vehicle の受信と L1 の state | `vehicle.py`、`hub.py`、`l1/request.py`・`l1/runner.py`・`l1/calibration.py`（`context`）、`config.py`、`config.example.toml`、`fusion.py`（L1Verdict.state_source） | 300      | #2     | unit・integration（HV・RQ・CFG・AC・AUTH） |
| 4   | feat(pwa): vehicle の送信                | `vehicle-report.ts`、`use-gps-zone.ts`、`edge-client.ts`、`use-vehicle-uplink.ts`、`DriveScreen.tsx`、`fake-edge.mjs`                                                | 250      | #2     | unit・component（VR・EC・UP・AC-c）        |
| 5   | docs: レビューの報告と spec_confirmed_at | `docs/reports/`、前の feature（edge-l1・edge-judge・pwa-connect・pwa-drive）の `spec_confirmed_at` と R2 の追記                                                      | 100      | #3・#4 | なし                                       |

### 依存グラフ

```
#1 spec ── #2 schema ──┬── #3 edge ──┬── #5 報告
                       └── #4 PWA  ──┘
```

## このフェーズで実装すること（In Scope）

- `ClientMessage` への `vehicle` の追加（追加だけ。既存の型は変えない）と、JSON Schema・Python のモデルの生成
- PWA: GPS から速度・ゾーン・光を作り、B-1 のあいだ 1 Hz で送る。座標は `useGpsZone` の外に出さない
- edge: `vehicle` の検証・保持・古さ（10 秒）・L1 の問い合わせの `state` への反映（項目ごとの固定値への戻し）、設定、`state_source` のログ
- 偽 edge の `vehicle` の出力

## このフェーズで実装しないこと（Out of Scope）

- ヘッドライトの実値、速度の平滑化・加速度、残り km・ゾーン ID の送信
- `calibration.json` の再学習（`dataset/export_l1_labels.py` の実値のモードを人 B が回す）
- `label` の送信、Capture（edge-capture）、`apps/sim`・`apps/api`・`apps/pwa` の capture まわり（別セッション）
- `AlertFlag` の変更。edge の起動の入口（CLI）

## リスクと対策

| リスク                                              | 対策                                                                                                                                                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 実値で L1 の入力の分布が校正と変わり、降格が増える  | 校正が `context: "real"` を宣言するまで実値を使わない。速度は 30 km/h で持ち上げ。降格の条件は変えない。`state_source` をログに出す。`vehicle_state = "fixed"` で切り離せる。再学習は Deferred |
| 位置が端末の外に出る                                | `vehicle` の型に位置の席が無い（strict）。PWA は `useGpsZone` の中だけで座標を使い、3 項目の派生値だけ出す                                                                                     |
| 受信が赤の経路を遅くする                            | 同期で数マイクロ秒の処理だけ。`on_result`・fusion を呼ばない。edge-latency-reviewer が確かめる                                                                                                 |
| 他セッション（edge-capture 等）と同じファイルを触る | `hub.py`・`config.py`・`edge-client.ts` は最小の差分。push の前に main を取り込む。競合したら取り込み側に合わせる                                                                              |
| 生成物（JSON Schema・pydantic）が古いまま           | UC-1i と `generate_models.py --check` のテストで検出                                                                                                                                           |
