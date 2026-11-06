// 描画のフレーム時間の要約（R9、ch6「requestAnimationFrame 計測を A-7 に記録」）。保存は record の feature。
// 落ちたフレームと走行の全体の数は performance R1（docs/specs/performance/functional.md）。

/**
 * 落ちたフレームとみなす間隔（ms）。その瞬間に 25 fps を割った＝30 fps の端末で 1 フレームを逃した・
 * 60 Hz で vsync を 2 回以上逃した。30 fps に張り付く端末の 33.3 ms の前後の揺れは数えない（spec-adversary 2）
 */
export const DROPPED_FRAME_MS = 40

/** 記録の fps の上限（記録の形 FrameSummarySchema の max）。1 ms 未満の間隔でも記録が弾かれないように丸める */
const MAX_FPS = 1000

export type FrameSummary = {
  /** fps の中央値（最新の窓） */
  fpsMedian: number
  /** fps の 5 パーセンタイル（遅い方。最新の窓） */
  fpsP5: number
  /** 窓のフレーム数（中央値・5 パーセンタイルの分母） */
  frames: number
  /** 落ちたフレーム（DROPPED_FRAME_MS を超えた間隔）の数（走行の全体） */
  dropped: number
  /** 数えたフレームの数（走行の全体。dropped の分母） */
  counted: number
}

/** 落ちたフレームか */
export function isDroppedFrame(ms: number): boolean {
  return ms > DROPPED_FRAME_MS
}

/** 走行の全体の数（エンジンが窓より長く数える） */
export type FrameTotals = { dropped: number; counted: number }

/**
 * フレーム時間（ms）の列から fps の中央値と 5 パーセンタイル（UC-9c）、落ちたフレームの数（performance UC-1a）。
 * totals を渡すとそれを使う（エンジンは列の窓より長い走行の全体で数える。UC-1b）。無ければ列の中で数える
 */
export function summarizeFrames(
  frameMs: readonly number[],
  totals?: FrameTotals,
): FrameSummary | null {
  const valid = frameMs.filter((ms) => ms > 0 && Number.isFinite(ms))
  if (valid.length === 0) return null
  const fps = valid.map((ms) => Math.min(MAX_FPS, 1000 / ms)).sort((a, b) => a - b)
  return {
    fpsMedian: quantile(fps, 0.5),
    fpsP5: quantile(fps, 0.05),
    frames: fps.length,
    dropped: totals?.dropped ?? valid.filter(isDroppedFrame).length,
    counted: totals?.counted ?? valid.length,
  }
}

/**
 * 開発用の表示の文字列（performance R2）。数字と記号だけ（訳す文言を持たない）。
 * 1 行目 fps の中央値 / 5 パーセンタイル、2 行目 落ちたフレーム / 数えたフレーム（走行の全体）
 */
export function formatFrameMeter(summary: FrameSummary | null): string {
  if (!summary) return 'fps --'
  const fps = (v: number) => v.toFixed(1)
  return [
    `fps ${fps(summary.fpsMedian)} p5 ${fps(summary.fpsP5)}`,
    `drop ${String(summary.dropped)} / ${String(summary.counted)}`,
  ].join('\n')
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
