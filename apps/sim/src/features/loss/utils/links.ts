import type { CollisionReport } from '../types'

// A6-4 の導線（functional.md R9）。

const REPLAY_LEAD_MS = 3000

/** 主ボタン: 同じ旅・同じ日の A-2 へ。alert のクエリ無し ＝ ON（brief-map の R6） */
export function retryHref(c: Pick<CollisionReport, 'tripId' | 'day'>): string {
  return `/trip/${encodeURIComponent(c.tripId)}/brief?day=${String(c.day)}`
}

/** 副: 衝突の 3 秒前から再生（drive の機能。drive が replay を読むまでは、その日の最初から走る） */
export function replayHref(
  c: Pick<CollisionReport, 'tripId' | 'day' | 'alertEnabled' | 'simMs'>,
): string {
  const q = new URLSearchParams({ trip: c.tripId, day: String(c.day) })
  if (!c.alertEnabled) q.set('alert', 'off')
  q.set('replay', String(Math.max(0, c.simMs - REPLAY_LEAD_MS)))
  return `/drive?${q.toString()}`
}
