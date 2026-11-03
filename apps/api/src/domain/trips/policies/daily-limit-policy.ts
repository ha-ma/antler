import { DailyLimitError } from '../errors/trip-errors.js'
import { DAY_MS, JST_OFFSET_MS } from '../rules/trip-rules.js'

// 全体の 1 日の上限（docs/specs/plan-trip/functional.md R9）。「日」は日本時間の暦日。
// 同時の作成で数件超えることは許す（resilience.md: 上限は費用の目安）。

/** nowMs を含む日本時間の暦日の始まり（ms）。 */
export function jstDayStartMs(nowMs: number): number {
  return Math.floor((nowMs + JST_OFFSET_MS) / DAY_MS) * DAY_MS - JST_OFFSET_MS
}

/** 当日の作成件数が上限に達していれば DailyLimitError。 */
export function ensureWithinDailyLimit(createdToday: number, dailyLimit: number): void {
  if (createdToday >= dailyLimit) throw new DailyLimitError()
}
