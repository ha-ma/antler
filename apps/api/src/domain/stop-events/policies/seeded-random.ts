// シード付き乱数（docs/specs/stop-events/functional.md R2。CLAUDE.md「乱数はシード付き」）。
// 旅の seed と日から mulberry32 を作る。同じ seed・同じ日なら同じ列。

export function seededRandom(seed: number, day: number): () => number {
  // 日ごとに別の列にする（黄金比の定数で混ぜる。束の用途の印 0x5354 = "ST"）
  let state = (seed ^ Math.imul(day + 0x5354, 0x9e3779b1)) >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
