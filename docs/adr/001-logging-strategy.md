# ADR 001: ログは構造化 JSON 1 行、print / console.log は使わない

- 状態: 採用（2026-11-03、/sfad init）
- 関係する要件: ch6「計測」（外部解析サービスは使わない）、ch6「B 遅延」（t_frame / t_sent / t_shown）

## 決めたこと

1. ログはすべて 1 行の JSON。共通の項目は `ts`（ISO 8601）・`level`・`event`（ドット区切りの名前。例: `http.request`、`flag.sent`）。ほかの項目はそのまま並べる
2. 出し方は場所ごとに 1 つだけ
   - apps/api: `src/infrastructure/logging/logger.ts`（標準出力）。`console` は ESLint で禁止
   - apps/sim・apps/pwa: `src/shared/utils/logger.ts`（`console.error` / `console.warn` だけ）。`console.log` は ESLint で禁止
   - edge/detector: `detector.log`（標準の logging に JSON の Formatter）。`print` は ruff（T20）で禁止
3. 未捕捉の例外は必ず記録する（api: `onError` と process のフック、FE: エラーバウンダリと window のフック、edge: `sys.excepthook`）
4. 利用者に返す応答にスタックトレースを出さない（api は本番で `detail` を付けない）
5. ログを外部の解析サービスに送らない。個人情報・精密な位置・秘密情報をログに入れない
6. api は 1 リクエストに `X-Request-Id` を付け、アクセスログとエラーログに `requestId` を入れる
7. B の遅延の計測に使う時刻（`t_frame`・`t_sent`・`t_shown`）は、走行ログに項目として残す（edge-latency-reviewer が読む）

## 理由

- 走行ログから遅延の p95 を出す（ch6）には、機械が読める形が要る
- print / console.log は本番で読めず、消し忘れが残る。lint で止める
- 1 週間・2 名なので、ログ基盤のライブラリは足さず、標準の仕組みに薄い層を足すだけにする

## 見送ったもの

- ログの集約サービス（外部送信は要件で禁止）
- OpenTelemetry（MVP の範囲では過剰）
