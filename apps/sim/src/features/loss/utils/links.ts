import type { CollisionReport } from '../types'

// A6-4 の導線（functional.md R9）。

const REPLAY_LEAD_MS = 3000

/** 主ボタン: 同じ旅・同じ日の A-2 へ。alert のクエリ無し ＝ ON（brief-map の R6） */
export function retryHref(c: Pick<CollisionReport, 'tripId' | 'day'>): string {
  return `/trip/${encodeURIComponent(c.tripId)}/brief?day=${String(c.day)}`
}

/**
 * 副:「この日を最初から走り直す」。同じ日を同じアラートの設定で、A-2 を通らずにその日の最初から走る。
 * 衝突の 3 秒前からのリプレイは 2026-11-06 にユーザーが見送った（result-screens R6）。drive は replay を読まず、
 * simMs は今は常に null なので replay は付かない（付いても drive は無視する）
 */
export function replayHref(
  c: Pick<CollisionReport, 'tripId' | 'day' | 'alertEnabled' | 'simMs'>,
): string {
  const q = new URLSearchParams({ trip: c.tripId, day: String(c.day) })
  if (!c.alertEnabled) q.set('alert', 'off')
  // 経過が分からない（DriveResult に無い）ときは replay を付けない（その日の最初から）
  if (c.simMs !== null) q.set('replay', String(Math.max(0, c.simMs - REPLAY_LEAD_MS)))
  return `/drive?${q.toString()}`
}
