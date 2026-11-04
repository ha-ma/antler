import type { TripPlan } from '@antler/schema'

// domain のテスト用のしおり（UC-2・UC-3）。ペルソナの旅は D2 の移動が 1 本・楽しみが 2 件なので、
// Test List の例（2 本目の移動・楽しみ 3 件・宿 D1〜D4・4 人）はここで手で組む。

export type PlanPart = Pick<TripPlan, 'days' | 'pleasures' | 'party'>

/** 4 人・5 日（宿は D1〜D4）・楽しみ 3 件（D2 に 2 件、D3 に 1 件） */
export const FIVE_DAYS: PlanPart = {
  party: { size: 4, drivers: 2, experience: 'first' },
  pleasures: [
    { id: 'red-crowned-crane', weight: 4 },
    { id: 'akan-onsen', weight: 2 },
    { id: 'drift-ice-walk', weight: 5 },
  ],
  days: [
    { day: 1, from: 'cts', to: 'kushiro', stops: [], stay: 'kushiro' },
    {
      day: 2,
      from: 'kushiro',
      to: 'akan',
      stops: ['red-crowned-crane', 'akan-onsen'],
      stay: 'akan',
    },
    { day: 3, from: 'akan', to: 'utoro', stops: ['drift-ice-walk'], stay: 'utoro' },
    { day: 4, from: 'utoro', to: 'utoro', stops: [], stay: 'utoro' },
    { day: 5, from: 'utoro', to: 'cts', stops: [], stay: null },
  ],
}

/** D2 の移動 2 本（釧路 → 鶴居 → 阿寒）。タンチョウは鶴居、温泉は阿寒 */
export const FIVE_DAYS_D2 = {
  legs: [
    { from: 'kushiro', to: 'tsurui' },
    { from: 'tsurui', to: 'akan' },
  ],
}

/** D1 の移動 1 本 */
export const FIVE_DAYS_D1 = { legs: [{ from: 'cts', to: 'kushiro' }] }

/** D5 の移動 1 本 */
export const FIVE_DAYS_D5 = { legs: [{ from: 'utoro', to: 'cts' }] }
