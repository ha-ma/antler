// シード付き乱数（R13）。ブラウザの乱数は使わない。同じ種からは同じ列が出る。

/** 0 以上 1 未満の数を返す関数 */
export type Rng = () => number

/** mulberry32。32 bit の種から決まった列を作る */
export function createRng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 種と名前から別の種を作る（候補ごと・用途ごとに独立した列にする） */
export function deriveSeed(seed: number, label: string | number): number {
  let h = (seed >>> 0) ^ 0x811c9dc5
  const text = String(label)
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  // 最後に攪拌して、近い名前でも離れた種にする
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b) >>> 0
  h ^= h >>> 13
  return h >>> 0
}

/** min 以上 max 以下の数 */
export function between(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng()
}

/** 重みつきで 1 つ選ぶ */
export function pickWeighted<T extends string>(rng: Rng, weights: Record<T, number>): T {
  const entries = Object.entries(weights) as [T, number][]
  const total = entries.reduce((sum, [, w]) => sum + w, 0)
  let r = rng() * total
  let last = entries[0]?.[0]
  for (const [key, w] of entries) {
    r -= w
    last = key
    if (r < 0) return key
  }
  if (last === undefined) throw new RangeError('選ぶものがありません')
  return last
}
