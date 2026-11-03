import { DailyLimitError } from '../errors/trip-errors.js'
import { DAY_MS, JST_OFFSET_MS } from '../rules/trip-rules.js'

// 全体の 1 日の上限（docs/specs/plan-trip/functional.md R9）。「日」は日本時間の暦日。
// 数えるのは保存した旅ではなく Claude の呼び出し（作り直しの 1 回・失敗した呼び出しも含む）。
// 呼び出しの前に当日の通し番号を DB で 1 つ進め、その番号が上限を超えていれば呼ばない。

/** nowMs を含む日本時間の暦日の始まり（ms）。 */
export function jstDayStartMs(nowMs: number): number {
  return Math.floor((nowMs + JST_OFFSET_MS) / DAY_MS) * DAY_MS - JST_OFFSET_MS
}

/**
 * 当日の何回目の呼び出しか（1 始まり）が上限を超えていれば DailyLimitError。
 * 上限ちょうど（callNumber === dailyCallLimit）までは呼べる。
 */
export function ensureWithinDailyLimit(callNumber: number, dailyCallLimit: number): void {
  if (callNumber > dailyCallLimit) throw new DailyLimitError()
}
