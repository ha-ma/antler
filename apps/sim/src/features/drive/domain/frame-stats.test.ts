import { describe, expect, it } from 'vitest'
import { DriveEngine } from './engine'
import { DROPPED_FRAME_MS, formatFrameMeter, summarizeFrames } from './frame-stats'
import { demoScenario } from './scenario'
import { ZONES } from './zones-data'

// performance R1・R2（docs/specs/performance/functional.md）: 運転中の rAF の要約に「落ちたフレーム」と
// 走行の全体の数を足す。開発用の表示の文字列。

const FRAME_60 = 1000 / 60

describe('フレームの要約（performance R1）', () => {
  it('UC-1a: 落ちたフレーム = 40 ms を超えた間隔の数（30 fps の 33.3 ms の揺れは数えない）', () => {
    expect(DROPPED_FRAME_MS).toBe(40)
    const frames = [
      ...Array<number>(90).fill(FRAME_60),
      33.4,
      36, // 30 fps に張り付いた端末の揺れ
      40, // ちょうどは落ちていない
      40.1,
      50,
      250,
    ]
    const s = summarizeFrames(frames)
    expect(s).toMatchObject({ dropped: 3, frames: 96, counted: 96 })
    expect(s?.fpsMedian).toBeCloseTo(60, 6)
  })

  it('UC-1b: 走行の全体の数を外から渡すと、それを使う。空の列は null', () => {
    const s = summarizeFrames([FRAME_60, FRAME_60], { dropped: 7, counted: 9000 })
    expect(s).toMatchObject({ frames: 2, dropped: 7, counted: 9000 })
    expect(summarizeFrames([], { dropped: 3, counted: 3 })).toBeNull()
  })

  it('UC-1g: 1 ms 未満の間隔でも fps は 1000 で頭打ち（記録の上限で弾かれない）', () => {
    const s = summarizeFrames([0.2, 0.5, 0.9])
    expect(s?.fpsMedian).toBe(1000)
    expect(s?.fpsP5).toBe(1000)
  })

  it('UC-1c: エンジンは覚えておく窓（7,200 フレーム）より前も走行の全体で数え、やり直しで 0 に戻す', () => {
    const engine = new DriveEngine(demoScenario(ZONES), ZONES)
    engine.frame(100)
    engine.frame(45)
    for (let i = 0; i < 7300; i += 1) engine.frame(FRAME_60)
    expect(engine.frameSummary()).toMatchObject({ frames: 7200, dropped: 2, counted: 7302 })
    engine.restart()
    expect(engine.frameSummary()).toBeNull()
    engine.frame(60)
    expect(engine.frameSummary()).toMatchObject({ dropped: 1, counted: 1 })
  })

  it('UC-1d: 一時停止の間のフレームは数えない', () => {
    const engine = new DriveEngine(demoScenario(ZONES), ZONES)
    engine.setPaused(true)
    engine.frame(500)
    engine.setPaused(false)
    engine.frame(FRAME_60)
    expect(engine.frameSummary()).toMatchObject({ frames: 1, dropped: 0, counted: 1 })
  })

  it('UC-1d: 終わった後（衝突・完走のバナーの間）のフレームは数えない', () => {
    const engine = new DriveEngine(demoScenario(ZONES), ZONES)
    engine.frame(FRAME_60)
    // 終了の状態だけを作る（衝突までを走らせる代わり）
    engine.world.outcome = 'collided'
    engine.frame(500)
    engine.frame(FRAME_60)
    expect(engine.frameSummary()).toMatchObject({ frames: 1, dropped: 0, counted: 1 })
  })
})

describe('開発用の表示の文字列（performance R2）', () => {
  it('UC-2a: fps の中央値・5 パーセンタイル、落ちたフレーム / 数えたフレーム（走行の全体）。まだ無ければ fps --', () => {
    const s = { fpsMedian: 59.94, fpsP5: 31.25, frames: 1200, dropped: 3, counted: 9000 }
    expect(formatFrameMeter(s)).toBe('fps 59.9 p5 31.3\ndrop 3 / 9000')
    expect(formatFrameMeter(null)).toBe('fps --')
  })
})
