// 描画の解像度（DPR）を自動で下げる段（performance R4、docs/specs/performance/functional.md）。
// 開発機（M2）では 60 fps に余裕があるが、弱い内蔵 GPU やスマホの GPU は測れていない（Deferred）ので、
// 遅い状態が続いたときだけ描く画素を減らす安全網。下げたら戻さない（行ったり来たりで画面がちらつかない）。
// 「遅い」の線は目標で変える（ch6: PC 60 fps、スマホ 30 fps 以上）。スマホは 30 fps に張り付く端末
// （省電力のモードなど）や 32〜44 fps でも目標どおりなので、30 fps を割ったときだけ下げる。

/** DPR の段（いちばん上は DriveCanvas の上限 1.5） */
export const DPR_STEPS = [1.5, 1.25, 1] as const
/** fps を測る窓（ms） */
export const QUALITY_WINDOW_MS = 2000
/** PC（細かいポインタ）: この fps を下回る窓が続いたら下げる（60 Hz で 4 フレームに 1 回以上逃している） */
export const LOW_FPS = 45
/** スマホ（粗いポインタ）: 目標の 30 fps を割ったら下げる（30 fps の張り付きは下げない） */
export const LOW_FPS_COARSE = 27
const LOW_WINDOWS = 2
/** これより長い間隔は数えない（タブを隠した・一時停止の後の 1 フレーム） */
const MAX_FRAME_MS = 1000

export type QualityState = {
  /** DPR_STEPS の添え字 */
  step: number
  /** いまの窓の経過（ms）とフレーム数 */
  windowMs: number
  frames: number
  /** 遅い窓が続いた数 */
  lowWindows: number
  /** 最初の窓（シェーダの組み立て・先読みの評価が重なる）を終えたか。最初の窓は判定しない */
  warm: boolean
}

export const INITIAL_QUALITY: QualityState = {
  step: 0,
  windowMs: 0,
  frames: 0,
  lowWindows: 0,
  warm: false,
}

/** 1 フレーム進める（frameMs は前のフレームからの実時間、lowFps は「遅い」の線） */
export function stepQuality(
  state: QualityState,
  frameMs: number,
  lowFps: number = LOW_FPS,
): QualityState {
  if (!(frameMs > 0) || frameMs > MAX_FRAME_MS) return state
  const windowMs = state.windowMs + frameMs
  const frames = state.frames + 1
  if (windowMs < QUALITY_WINDOW_MS) return { ...state, windowMs, frames }
  if (!state.warm) return { ...state, windowMs: 0, frames: 0, warm: true }
  const fps = (frames * 1000) / windowMs
  const lowWindows = fps < lowFps ? state.lowWindows + 1 : 0
  const last = DPR_STEPS.length - 1
  if (lowWindows >= LOW_WINDOWS && state.step < last) {
    return { step: state.step + 1, windowMs: 0, frames: 0, lowWindows: 0, warm: true }
  }
  return { step: state.step, windowMs: 0, frames: 0, lowWindows, warm: true }
}

/** その段の DPR（端末の DPR より上げない。1 より下げない＝DriveCanvas の dpr の下限） */
export function dprOf(state: QualityState, deviceDpr: number): number {
  const step: number = DPR_STEPS[state.step] ?? 1
  return Math.max(1, Math.min(deviceDpr, step))
}

/** 「遅い」の線（粗いポインタ＝スマホは 30 fps 目標、それ以外は 60 fps 目標） */
export function lowFpsFor(coarsePointer: boolean): number {
  return coarsePointer ? LOW_FPS_COARSE : LOW_FPS
}
