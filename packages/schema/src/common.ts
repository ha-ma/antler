import { z } from 'zod'

// A と B で共通の部品。時刻は ISO 8601 のタイムゾーン付き（ch7「時刻は ISO 8601（JST）」）。

/**
 * タイムゾーン付きの ISO 8601。`Z` も `+09:00` も通す。タイムゾーン無しは拒否する。
 * 秒を省いた分までの表記（ch7 の TripPlan の例 `2027-02-14T10:00+09:00`）も通す。
 */
export const IsoDateTime = z.union([
  z.iso.datetime({ offset: true }),
  z.iso.datetime({ offset: true, precision: -1 }),
])

/** UI の言語。zh は繁体字（zh-TW）。 */
export const Lang = z.enum(['ja', 'en', 'zh', 'ko'])
export type Lang = z.infer<typeof Lang>

/** 鹿の方向（ボックス中心の左右。B2-4）。 */
export const Side = z.enum(['L', 'R'])
export type Side = z.infer<typeof Side>

/** 小文字と `_` の語彙（Capture の天気・路面、JudgeRequest の位置など。値の一覧を列挙にしない項目）。 */
export const Vocab = z.string().regex(/^[a-z][a-z_]*$/)

/** 光の区分（太陽の高さで決める。Capture と JudgeRequest が同じ語を使う）。 */
export const Light = z.enum(['dawn', 'day', 'dusk', 'night'])
export type Light = z.infer<typeof Light>

/** L1 の質問 alert_level の答えと AlertFlag.l1 の段階（none = 緑、zone = 琥珀、danger = 赤）。 */
export const AlertLevel = z.enum(['none', 'zone', 'danger'])
export type AlertLevel = z.infer<typeof AlertLevel>

/** 小文字の英数字とハイフンの識別子（楽しみの ID、地点、宿など）。 */
export const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/** タイムゾーン付きの ISO 8601 を JST（+09:00）のミリ秒つき表記に直す。読めなければ例外。 */
export function toJst(iso: string): string {
  if (!IsoDateTime.safeParse(iso).success) {
    throw new RangeError('タイムゾーン付きの ISO 8601 ではありません')
  }
  const shifted = new Date(Date.parse(iso) + JST_OFFSET_MS)
  return `${shifted.toISOString().slice(0, 23)}+09:00`
}
