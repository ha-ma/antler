# 計画: pwa-https（車ごとの CA で PWA・wss・Capture を https にする）

PR は 1 つ（ブランチ `claude/confident-shaw-1d568c`、base は main）。1 feature = 1 PR（CLAUDE.md）。
edge（Python）と PWA（TypeScript）は互いの import が無く、契約はポートとパス（8443・8080・8765・8767、`/alerts`・`/healthz`・`/ezoroad-ca.crt`）と `VITE_EDGE_HOSTS` だけ。コミットを部品ごとに分ける。
合計は約 1,600 行の見込み（実装 約 700 行、テスト 約 700 行、runbook と仕様 約 500 行）。**1 PR ≤ 1000 行の目安を超える理由**: 受け入れ AC-1 が証明書・3 つのサーバー・PWA の接続先を 1 本でつなぐので、分けると「https のページから ws につなぐ」片側だけの期間ができる。コミット単位で読める形にする。

## Implementation Plan

### PR チェーン（コミット単位）

| #   | タイトル                              | 含むもの                                                                                                                                              | 行数目安 | 依存                            | テスト要件                            |
| --- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------- | ------------------------------------- |
| 1   | docs(spec): pwa-https                 | functional / threat / resilience / plan、spec-adversary の報告                                                                                        | 500      | なし                            | なし                                  |
| 2   | feat(edge): 証明書の発行と TLS の設定 | `scripts/make_tls.py`、`detector/tls.py`、`config.py` の `[tls]`・`[pwa_server]`、`config.example.toml`、`.gitignore`                                 | 350      | #1                              | UC-1・UC-2・AUTH-12〜14・FAIL-1〜3    |
| 3   | feat(edge): wss と https（Capture）   | `server.py`・`capture/http.py`・`capture/service.py` の `ssl_context`                                                                                 | 100      | #2                              | UC-3・AUTH-11・FAIL-4〜6              |
| 4   | feat(edge): PWA の配信と CA の配布    | `detector/pwa_server.py`                                                                                                                              | 350      | #2                              | UC-4・AUTH-1〜10・AUTH-15・FAIL-7〜10 |
| 5   | feat(pwa): 同じホストの edge につなぐ | `edge-hosts.ts`・`csp.ts`・`vite.config.ts`・`src/shared/lib/edge-origin.ts`・`edge-url.ts`・`capture-url.ts`・`services.ts`、`fake-edge.mjs` の TLS  | 300      | #1（契約）。#2〜#4 と並行できる | UC-5・UC-6                            |
| 6   | test: 受け入れ AC-1 と runbook        | `tests/test_pwa_https_acceptance.py`、`docs/runbooks/2026-11-06-pwa-https.md`（iOS Simulator の結果）                                                 | 300      | #3・#4・#5                      | AC-1・AC-2                            |
| 7   | docs: 関係する仕様の更新              | pwa-connect（R1 の接続先と CSP、Deferred の解決）・pwa-drive（Deferred の解決）・edge-capture（Capture の URL）ほか spec_confirmed_at、レビューの報告 | 100      | #2〜#6                          | なし                                  |

### 依存グラフ

```
#1 spec ──┬── #2 tls ──┬── #3 wss/https ──┐
          │            └── #4 pwa_server ──┼── #6 AC・runbook ── #7 仕様の更新
          └── #5 pwa ─────────────────────┘
```

## このフェーズで実装すること（In Scope）

- 車ごとの CA（名前の制約つき）とサーバー証明書を作るスクリプト
- `[tls]`・`[pwa_server]` の設定、`SSLContext` を作る関数
- AlertServer（wss）と CaptureServer（https）の TLS
- PWA の静的配信（https）と CA の配布・設定ページ（http）
- PWA の接続先（ページと同じホスト、`VITE_EDGE_HOSTS`）と CSP
- 偽 edge の TLS
- runbook（Mac mini・iOS・Android・カードの QR・罠）と iOS Simulator での確かめ

## このフェーズで実装しないこと（Out of Scope）

- Wi-Fi AP の設定と Wi-Fi の QR の発行（edge の AP の feature）
- edge を 1 コマンドで起動する入口（edge-run、並走中）。この feature は `ssl_context` を受け取れるようにするだけ
- manifest・Service Worker（Deferred。pwa-drive の続き）
- (c′) 持っているドメインと Let's Encrypt（Deferred。ユーザーの判断）
- PWA の画面・文言の変更（B-0 の案内は今のまま）
- `packages/schema`・`packages/alert-ui` の変更（凍結。触らない）

## マイグレーション統合

- edge: `[tls]` が空なら今と同じ（ws・http）。既存の設定ファイルはそのまま読める（セクションが無ければ既定）
- PWA: `VITE_EDGE_HOSTS` が無ければ `ezoroad.local` だけ。http で開いた場合は今と同じ `ws://ezoroad.local:8765/alerts`
- 生成物（`edge/detector/tls/`）は git に入れない（`.gitignore` に足す）。戻す操作はディレクトリの削除とスマホのプロファイルの削除

## 凍結

`packages/schema`・`packages/alert-ui` は変更しない。AlertFlag・ClientMessage の形・WebSocket のパスは変えない（スキームだけ）。alert-contract-guard で Critical 0 を確かめる。

## 並行セッションとの境界

- edge-run（`claude/unruffled-saha-55c99e`）: edge の起動の入口を作る。`config.py` は新しいセクションの追加だけ（既存の `[server]` のキーは変えない）、`server.py` はキーワード引数の追加だけ。共有ノート `pwa-https-touching-files.md` に書いた。先にマージされた方に合わせて、あとの方が入口で `ssl_context=tls.server_context(config)` を渡す
