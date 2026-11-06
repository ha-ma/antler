import { describe, expect, it } from 'vitest'
import {
  DPR_STEPS,
  INITIAL_QUALITY,
  LOW_FPS,
  LOW_FPS_COARSE,
  QUALITY_WINDOW_MS,
  dprOf,
  lowFpsFor,
  stepQuality,
  type QualityState,
} from './quality'

// performance R4: 描画の解像度（DPR）を自動で下げる段

function run(state: QualityState, frameMs: number, totalMs: number, lowFps?: number): QualityState {
  let s = state
  for (let t = 0; t < totalMs; t += frameMs) s = stepQuality(s, frameMs, lowFps)
  return s
}

/** 最初の窓（判定しない）を 60 fps で終えた状態 */
const WARM = run(INITIAL_QUALITY, 1000 / 60, 2100)

describe('解像度を自動で下げる段（performance R4）', () => {
  it('UC-4a: 段は 1.5 → 1.25 → 1。端末の DPR より上げない', () => {
    expect(DPR_STEPS).toEqual([1.5, 1.25, 1])
    expect(dprOf(INITIAL_QUALITY, 2)).toBe(1.5)
    expect(dprOf(INITIAL_QUALITY, 1)).toBe(1)
    expect(dprOf({ ...INITIAL_QUALITY, step: 1 }, 3)).toBe(1.25)
    expect(dprOf({ ...INITIAL_QUALITY, step: 2 }, 3)).toBe(1)
  })

  it('UC-4b: 2 秒の窓の fps が 45 未満の窓が 2 つ続いたら 1 段下げる。60 fps では下げない', () => {
    expect(LOW_FPS).toBe(45)
    expect(QUALITY_WINDOW_MS).toBe(2000)
    expect(WARM.warm).toBe(true)
    expect(run(INITIAL_QUALITY, 1000 / 60, 10_000).step).toBe(0)
    // 40 fps: 1 つ目の窓では下げず、2 つ目で下げる
    const one = run(WARM, 25, 2000)
    expect(one).toMatchObject({ step: 0, lowWindows: 1 })
    const two = run(one, 25, 2000)
    expect(two).toMatchObject({ step: 1, lowWindows: 0 })
  })

  it('UC-4c: 遅い窓と速い窓が交互なら下げない（続いたときだけ）', () => {
    let s = WARM
    for (let i = 0; i < 4; i += 1) {
      s = run(s, 25, 2000)
      s = run(s, 1000 / 60, 2100)
    }
    expect(s.step).toBe(0)
  })

  it('UC-4d: 下げたら戻さない。いちばん下（1）より下げない', () => {
    const s = run(INITIAL_QUALITY, 50, 20_000)
    expect(s.step).toBe(DPR_STEPS.length - 1)
    expect(run(s, 1000 / 60, 20_000).step).toBe(DPR_STEPS.length - 1)
  })

  it('UC-4e: 1 秒を超える間隔（タブを隠した・止めた）は数えない', () => {
    let s = INITIAL_QUALITY
    for (let i = 0; i < 10; i += 1) s = stepQuality(s, 5000)
    expect(s).toEqual(INITIAL_QUALITY)
  })

  it('UC-4g: 最初の窓（シェーダの組み立てなど）は遅くても判定しない', () => {
    const first = run(INITIAL_QUALITY, 50, 2000)
    expect(first).toMatchObject({ step: 0, lowWindows: 0, warm: true })
    // 次の窓から数える
    expect(run(first, 50, 4000).step).toBe(1)
  })

  it('UC-4h: スマホ（粗いポインタ）は 30 fps の張り付きや 40 fps では下げず、30 fps を割ったら下げる', () => {
    expect(lowFpsFor(true)).toBe(LOW_FPS_COARSE)
    expect(lowFpsFor(false)).toBe(LOW_FPS)
    const coarse = lowFpsFor(true)
    expect(run(WARM, 1000 / 30, 20_000, coarse).step).toBe(0)
    expect(run(WARM, 25, 20_000, coarse).step).toBe(0)
    expect(run(WARM, 1000 / 20, 4000, coarse).step).toBe(1)
  })
})
