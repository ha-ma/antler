// 距離の表示（functional.md R12）。数値は IBM Plex Mono で、単位は別の要素として小さく後置する（ch8）。

const NONE = '--'

function usable(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** km: 10 未満は小数 1 桁、10 以上は整数。無い・負・NaN は「--」。 */
export function formatKm(value: number | null | undefined): string {
  if (!usable(value)) return NONE
  const tenth = Math.round(value * 10) / 10
  return tenth < 10 ? tenth.toFixed(1) : String(Math.round(value))
}

/** m: 整数。無い・負・NaN は「--」。 */
export function formatM(value: number | null | undefined): string {
  if (!usable(value)) return NONE
  return String(Math.round(value))
}
