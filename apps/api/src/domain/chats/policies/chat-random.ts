// シード付き乱数（docs/specs/drive-audio-chat/functional.md R11。CLAUDE.md「乱数はシード付き」）。
// 旅の seed と日から mulberry32 を作る。stop-events の束（seededRandom）と同じ列にしないよう、混ぜる印を変える（0x4348 = "CH"）。

export function chatRandom(seed: number, day: number): () => number {
  let state = (seed ^ Math.imul(day + 0x4348, 0x9e3779b1)) >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
