// 構造化ログの出口（infrastructure/logging の Logger がそのまま満たす）。
// ownerToken・冪等キー・API キー・Claude の本文・IP は渡さない（threat.md「ログのマスキング」）。

export type EventFields = Record<string, unknown>

export interface EventLog {
  info(event: string, fields?: EventFields): void
  warn(event: string, fields?: EventFields): void
  error(event: string, fields?: EventFields): void
}
