import { AlertSoundController, type AudioPort } from '@antler/alert-ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { World } from '../types'
import { attentiveDriver } from './drive-harness'
import { demoScenario } from './scenario'
import { advance, createWorld, setInput, setRate, type SimEvent } from './simulation'
import { ZONES } from './zones-data'

// 受け入れテスト（外側ループ）。固定の場面を頭なしで最後まで走らせる。

const FRAME_MS = 1000 / 60

type Run = {
  world: World
  states: string[]
  events: { t: number; event: SimEvent }[]
  inputs: string[]
  chimes: number
  beeps: number
  soundUpdates: number
}

function fakePort() {
  const port = {
    unlock: vi.fn(() => Promise.resolve()),
    playChime: vi.fn(),
    playBeep: vi.fn(),
    speak: vi.fn(),
    cancelSpeech: vi.fn(),
  }
  return port satisfies AudioPort
}

/** 最後まで（または maxMinutes の実時間まで）走らせる。ゾーンの外は 16× */
async function drive(search: string, seed?: number, maxMinutes = 60): Promise<Run> {
  vi.useFakeTimers()
  vi.setSystemTime(Date.parse('2026-11-03T09:00:00Z'))
  const base = demoScenario(ZONES, search)
  const scenario = seed === undefined ? base : { ...base, seed }
  const world = createWorld(scenario, ZONES)
  const port = fakePort()
  let sound = new AlertSoundController(port)
  await sound.unlock()
  const run: Run = {
    world,
    states: [],
    events: [],
    inputs: [],
    chimes: 0,
    beeps: 0,
    soundUpdates: 0,
  }
  const maxFrames = (maxMinutes * 60_000) / FRAME_MS
  for (let f = 0; f < maxFrames && world.outcome === 'driving'; f++) {
    if (!world.playback.locked && world.playback.rate !== 16) setRate(world, 16)
    const input = attentiveDriver(world)
    run.inputs.push(JSON.stringify(input))
    setInput(world, input)
    const events = advance(world, FRAME_MS, ZONES)
    for (const event of events) run.events.push({ t: world.t, event })
    // DrivePage と同じく、ステージを移ったら同じ出力先でコントローラを作り直す（drive-tune R1）
    if (events.some((e) => e.type === 'stage-clear') && world.outcome === 'driving') {
      sound.dispose()
      sound = new AlertSoundController(port)
      await sound.unlock()
    }
    if (run.states.at(-1) !== world.alert.state) run.states.push(world.alert.state)
    // AlertState と同じく、毎フレーム音のコントローラへ渡す（アラート OFF では AlertState を描かない＝渡さない）
    if (scenario.alertEnabled) {
      sound.update({
        state: world.alert.state,
        distance: world.alert.distance,
        lang: 'ja',
        muted: false,
      })
      run.soundUpdates += 1
    }
    vi.advanceTimersByTime(FRAME_MS)
  }
  sound.dispose()
  run.chimes = port.playChime.mock.calls.length
  run.beeps = port.playBeep.mock.calls.length
  vi.useRealTimers()
  return run
}

afterEach(() => {
  vi.useRealTimers()
})

describe('drive-3d 受け入れ', () => {
  it('AC-1: アラート ON で最後まで走ると、safe で始まり、2 区間で zone とチャイムが 1 回ずつ、区間の中で danger（ビープ）、終点で完走', async () => {
    const run = await drive('')
    expect(run.world.outcome).toBe('completed')
    expect(run.states[0]).toBe('safe')
    const entries = run.events.filter((e) => e.event.type === 'zone-enter')
    expect(entries.map((e) => (e.event.type === 'zone-enter' ? e.event.interval : -1))).toEqual([
      0, 1,
    ])
    expect(run.chimes).toBe(2)
    expect(run.states).toContain('danger')
    expect(run.beeps).toBeGreaterThan(0)
    expect(run.states.at(-1)).toBe('safe')
    // danger は区間の中でだけ出る（鹿はゾーンの外に出ない）
    const alerts = run.events.filter((e) => e.event.type === 'alert-start')
    expect(alerts.length).toBeGreaterThan(0)
  }, 120_000)

  it('AC-2: アラート OFF では danger が一度も出ず、音は鳴らさず、区間の中のゾーン状態は琥珀', async () => {
    const run = await drive('?alert=off')
    expect(run.world.outcome).toBe('completed')
    expect(run.states).not.toContain('danger')
    expect(run.states).toContain('zone')
    expect(run.world.flag).toBeNull()
    expect(run.soundUpdates).toBe(0)
    expect(run.chimes).toBe(0)
    expect(run.beeps).toBe(0)
  }, 120_000)

  it('AC-3: 同じシード・同じ入力の列なら、出た鹿・検知の時刻・遭遇の記録が一致する。シードを変えると配置が変わる', async () => {
    const a = await drive('', undefined, 8)
    const b = await drive('', undefined, 8)
    expect(b.inputs).toEqual(a.inputs)
    expect(b.events).toEqual(a.events)
    expect(b.world.encounters).toEqual(a.world.encounters)
    // 種は場面の seed（旅のシードと日から。drive-link R4）
    const other = createWorld({ ...demoScenario(ZONES), seed: 1 }, ZONES)
    expect(other.candidates).not.toEqual(a.world.candidates)
  }, 120_000)
})
