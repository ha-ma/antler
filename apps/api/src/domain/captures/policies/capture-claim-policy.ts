import { CAPTURE_STALE_PENDING_MS } from '../rules/capture-rules.js'

// 書きかけ（pending）の保存の扱い（docs/specs/deploy-a/functional.md R9）。純粋関数だけ。
// pending で行を取ってから画像を置き、done にする。途中で止まった要求の pending は、時間がたてば次の再送が引き継ぐ。

/** pending の行が、書いた要求が止まったとみなせるほど古いか（ちょうど境目は古い扱い） */
export function isStalePending(updatedAtMs: number, nowMs: number): boolean {
  return updatedAtMs <= nowMs - CAPTURE_STALE_PENDING_MS
}

/** これ以下の updated_at の pending は引き継いでよい（SQL の条件に渡す値） */
export function stalePendingBefore(nowMs: number): number {
  return nowMs - CAPTURE_STALE_PENDING_MS
}
