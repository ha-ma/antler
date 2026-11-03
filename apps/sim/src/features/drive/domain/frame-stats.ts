// 描画のフレーム時間の要約（R9、ch6「requestAnimationFrame 計測を A-7 に記録」）。保存は record の feature。

export type FrameSummary = {
  /** fps の中央値 */
  fpsMedian: number
  /** fps の 5 パーセンタイル（遅い方） */
  fpsP5: number
  frames: number
}

/** フレーム時間（ms）の列から fps の中央値と 5 パーセンタイル（UC-9c） */
export function summarizeFrames(frameMs: readonly number[]): FrameSummary | null {
  const fps = frameMs.filter((ms) => ms > 0 && Number.isFinite(ms)).map((ms) => 1000 / ms)
  if (fps.length === 0) return null
  fps.sort((a, b) => a - b)
  return { fpsMedian: quantile(fps, 0.5), fpsP5: quantile(fps, 0.05), frames: fps.length }
}

/** 並べた列の分位点（線形補間） */
function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  const a = sorted[lo] ?? 0
  const b = sorted[hi] ?? a
  return a + (b - a) * (pos - lo)
}
