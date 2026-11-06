import { describe, expect, it } from 'vitest'
import { gameAudioEnabled } from './audio-env'
import { brakeVoice, SQUEAL_SAMPLE_S, squealDue } from './brake-voice'
import { engineRpm, engineVoice, virtualGear } from './engine-voice'
import { DEFAULT_AUDIO_SETTINGS, mixLevels } from './mix'
import { IDLE_SIGNALS, type DriveAudioSignals } from './signals'

const sig = (over: Partial<DriveAudioSignals>): DriveAudioSignals => ({ ...IDLE_SIGNALS, ...over })

describe('鳴らすかの決まり（R1）', () => {
  it('AUD-3a: 本番は鳴らす。開発は VITE_GAME_AUDIO=on のときだけ', () => {
    expect(gameAudioEnabled({ DEV: false })).toBe(true)
    expect(gameAudioEnabled({ DEV: false, VITE_GAME_AUDIO: 'off' })).toBe(true)
    expect(gameAudioEnabled({ DEV: true })).toBe(false)
    expect(gameAudioEnabled({ DEV: true, VITE_GAME_AUDIO: 'off' })).toBe(false)
    expect(gameAudioEnabled({ DEV: true, VITE_GAME_AUDIO: 'on' })).toBe(true)
  })
})

describe('エンジン音（R3）', () => {
  it('AUD-3b: 速さから仮のギア（20 km/h ごとの 5 段）を選ぶ', () => {
    expect(virtualGear(0)).toBe(1)
    expect(virtualGear(19.9)).toBe(1)
    expect(virtualGear(20)).toBe(2)
    expect(virtualGear(59)).toBe(3)
    expect(virtualGear(79)).toBe(4)
    expect(virtualGear(100)).toBe(5)
    expect(virtualGear(140)).toBe(5)
  })

  it('AUD-3b: 合図の rpm（drive-tune の telemetry）を使う。無ければ仮のギアの中の割合で 750〜2,700 rpm、アクセルで +300', () => {
    expect(engineRpm(sig({ speedKmh: 30, rpm: 2100 }))).toBe(2100)
    expect(engineRpm(sig({ speedKmh: 0 }))).toBe(750)
    expect(engineRpm(sig({ speedKmh: 10 }))).toBe(1725)
    expect(engineRpm(sig({ speedKmh: 10, throttle: 1 }))).toBe(2025)
    expect(engineRpm(sig({ speedKmh: 40 }))).toBe(750)
    expect(engineRpm(sig({ speedKmh: 100, throttle: 1 }))).toBe(3000)
    // 上限 6,000
    expect(engineRpm(sig({ speedKmh: 30, rpm: 9000 }))).toBe(6000)
  })

  it('AUD-3b: 音の高さは 4 気筒の爆発の周波数（rpm ÷ 30 Hz）', () => {
    expect(engineVoice(sig({ speedKmh: 0 })).freqHz).toBe(25)
    expect(engineVoice(sig({ speedKmh: 0, rpm: 3600 })).freqHz).toBe(120)
  })

  it('AUD-3c: 大きさ: アイドリング 0.25、回転とアクセルで上がり上限 0.9、一時停止と終わりは 0', () => {
    expect(engineVoice(sig({ speedKmh: 0 })).gain).toBeCloseTo(0.25)
    const cruising = engineVoice(sig({ speedKmh: 50 })).gain
    expect(cruising).toBeGreaterThan(0.25)
    expect(engineVoice(sig({ speedKmh: 50, throttle: 1 })).gain).toBeGreaterThan(cruising)
    expect(engineVoice(sig({ speedKmh: 99, throttle: 1, rpm: 6000 })).gain).toBeCloseTo(0.9)
    expect(engineVoice(sig({ speedKmh: 50, paused: true })).gain).toBe(0)
    expect(engineVoice(sig({ speedKmh: 50, outcome: 'collided' })).gain).toBe(0)
    expect(engineVoice(sig({ speedKmh: 0, outcome: 'completed' })).gain).toBe(0)
  })
})

describe('ブレーキ音（R4）', () => {
  it('AUD-3d・SND-2b: 3 km/h 未満は鳴らさない。こすれは強さ × min(1, 速さ ÷ 60) × 0.8', () => {
    expect(brakeVoice(sig({ speedKmh: 2.9, brake: 1 }))).toEqual({ noise: 0, squeal: 0, absHz: 0 })
    expect(brakeVoice(sig({ speedKmh: 30, brake: 1 })).noise).toBeCloseTo(0.4)
    expect(brakeVoice(sig({ speedKmh: 90, brake: 0.5 })).noise).toBeCloseTo(0.4)
    expect(brakeVoice(sig({ speedKmh: 60, brake: 0 })).noise).toBe(0)
    // 40 km/h・全力・音量 60 で 0.2 以上（前は 0.144 で聞こえなかった）
    expect(
      mixLevels(sig({ speedKmh: 40, brake: 1 }), DEFAULT_AUDIO_SETTINGS).brakeNoise,
    ).toBeGreaterThanOrEqual(0.2)
  })

  it('AUD-3d・SND-2c: 鳴きは強さ 0.7 以上・20 km/h 以上で 0.8 × 強さ（S キーの 0.6 では鳴かない）。ABS は 0.6 倍で 14 Hz の断続', () => {
    expect(brakeVoice(sig({ speedKmh: 60, brake: 1 })).squeal).toBeCloseTo(0.8)
    expect(brakeVoice(sig({ speedKmh: 60, brake: 0.6 })).squeal).toBe(0)
    expect(brakeVoice(sig({ speedKmh: 60, brake: 0.7 })).squeal).toBeCloseTo(0.56)
    expect(brakeVoice(sig({ speedKmh: 19, brake: 1 })).squeal).toBe(0)
    expect(brakeVoice(sig({ speedKmh: 60, brake: 1 })).absHz).toBe(0)
    expect(brakeVoice(sig({ speedKmh: 60, brake: 1, abs: true })).absHz).toBe(14)
    expect(brakeVoice(sig({ speedKmh: 60, brake: 1, abs: true })).squeal).toBeCloseTo(0.48)
    expect(squealDue(0.5, null, 3)).toBe(true)
    expect(squealDue(0.5, 3, 3 + SQUEAL_SAMPLE_S - 0.01)).toBe(false)
    expect(squealDue(0.5, 3, 3 + SQUEAL_SAMPLE_S)).toBe(true)
    expect(squealDue(0, null, 3)).toBe(false)
    // 止まった・一時停止・終わりでは鳴らさない
    expect(brakeVoice(sig({ speedKmh: 60, brake: 1, paused: true })).noise).toBe(0)
    expect(brakeVoice(sig({ speedKmh: 60, brake: 1, outcome: 'collided' })).noise).toBe(0)
  })
})

describe('混ぜ方（R6）', () => {
  const running = sig({ speedKmh: 60, throttle: 1, brake: 1 })

  it('AUD-3e: 実際の大きさ = 部品 × 音量 ÷ 100 × 係数（エンジン 0.5・ブレーキ 1.0・BGM 0.3・通知 0.5・衝突 1.0）', () => {
    const levels = mixLevels(running, { volume: 100, muted: false, music: true })
    expect(levels.engine).toBeCloseTo(engineVoice(running).gain * 0.5)
    expect(levels.brakeNoise).toBeCloseTo(brakeVoice(running).noise)
    expect(levels.brakeSqueal).toBeCloseTo(brakeVoice(running).squeal)
    expect(levels.music).toBeCloseTo(0.3)
    expect(levels.musicOn).toBe(true)
    expect(levels.notify).toBeCloseTo(0.5)
    expect(levels.notifyTones).toBe(2)
    expect(levels.crash).toBeCloseTo(1)
    expect(levels.engineFreqHz).toBe(engineVoice(running).freqHz)
    const half = mixLevels(running, { volume: 50, muted: false, music: true })
    expect(half.engine).toBeCloseTo(levels.engine / 2)
    expect(half.music).toBeCloseTo(0.15)
  })

  it('SND-2d: 鳴きの大きさは全体の音量 × 係数 × 強さ。消音で 0。赤で 0.5 倍', () => {
    const full = mixLevels(running, DEFAULT_AUDIO_SETTINGS)
    const half = mixLevels(running, { ...DEFAULT_AUDIO_SETTINGS, volume: 40 })
    expect(full.brakeSqueal).toBeGreaterThan(0)
    expect(half.brakeSqueal).toBeCloseTo((full.brakeSqueal * 40) / DEFAULT_AUDIO_SETTINGS.volume)
    expect(mixLevels(running, { ...DEFAULT_AUDIO_SETTINGS, muted: true }).brakeSqueal).toBe(0)
    const red = mixLevels({ ...running, alert: 'danger' }, DEFAULT_AUDIO_SETTINGS)
    expect(red.brakeSqueal).toBeCloseTo(full.brakeSqueal * 0.5)
  })

  it('AUD-3e・SND-1d: 消音は全部 0（曲も止める）、BGM OFF は BGM だけ 0・止める', () => {
    const muted = mixLevels(running, { volume: 100, muted: true, music: true })
    expect([
      muted.engine,
      muted.brakeNoise,
      muted.brakeSqueal,
      muted.music,
      muted.notify,
      muted.crash,
    ]).toEqual([0, 0, 0, 0, 0, 0])
    expect(muted.musicOn).toBe(false)
    expect(mixLevels(running, { volume: 0, muted: false, music: true }).musicOn).toBe(false)
    const noMusic = mixLevels(running, { volume: 100, muted: false, music: false })
    expect(noMusic.music).toBe(0)
    expect(noMusic.musicOn).toBe(false)
    expect(noMusic.engine).toBeGreaterThan(0)
  })

  it('AUD-3e・SND-3a: 赤の間は BGM 0（流したまま）・エンジンとブレーキは半分・通知 0。琥珀は BGM と通知音 0.6 倍・通知音は 1 音', () => {
    const base = mixLevels(running, DEFAULT_AUDIO_SETTINGS)
    const danger = mixLevels({ ...running, alert: 'danger' }, DEFAULT_AUDIO_SETTINGS)
    expect(danger.music).toBe(0)
    expect(danger.musicOn).toBe(true)
    expect(danger.notify).toBe(0)
    expect(danger.engine).toBeCloseTo(base.engine / 2)
    expect(danger.brakeNoise).toBeCloseTo(base.brakeNoise / 2)
    expect(danger.brakeSqueal).toBeCloseTo(base.brakeSqueal / 2)
    const zone = mixLevels({ ...running, alert: 'zone' }, DEFAULT_AUDIO_SETTINGS)
    expect(zone.music).toBeCloseTo(base.music * 0.6)
    expect(zone.engine).toBeCloseTo(base.engine)
    // 琥珀の間も通知音を鳴らす（drive-sound-tourism S11 で R8 を変えた）
    expect(zone.notify).toBeCloseTo(base.notify * 0.6)
    expect(zone.notifyTones).toBe(1)
  })

  it('AUD-3e: アラート OFF の走行では、ゾーンで BGM を下げず、通知音も鳴る（R6a）', () => {
    const base = mixLevels(running, DEFAULT_AUDIO_SETTINGS)
    const offZone = mixLevels(
      { ...running, alert: 'zone', alertEnabled: false },
      DEFAULT_AUDIO_SETTINGS,
    )
    expect(offZone.music).toBeCloseTo(base.music)
    expect(offZone.notify).toBeCloseTo(base.notify)
    expect(offZone.notifyTones).toBe(2)
  })

  it('AUD-3e・SND-1d: 走行の終わりは BGM も 0・曲を止める。一時停止の間は BGM を流したまま。衝突の音は終わりの後も鳴らす', () => {
    const ended = mixLevels(sig({ outcome: 'collided' }), DEFAULT_AUDIO_SETTINGS)
    expect(ended.music).toBe(0)
    expect(ended.musicOn).toBe(false)
    expect(ended.crash).toBeGreaterThan(0)
    expect(mixLevels(sig({ paused: true }), DEFAULT_AUDIO_SETTINGS).music).toBeGreaterThan(0)
  })
})
