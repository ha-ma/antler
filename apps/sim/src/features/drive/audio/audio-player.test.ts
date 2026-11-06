import { describe, expect, it, vi } from 'vitest'
import { AudioSettingsStore, parseAudioSettings, SETTINGS_KEY } from './audio-settings'
import type { AudioGraphPort, ScheduledNote } from './audio-graph'
import { DriveAudio } from './drive-audio'
import type { AudioLevels } from './mix'
import { NOTIFY_MIN_INTERVAL_MS, NOTIFY_TONES, NotifyGate } from './notify-tone'
import { BAR_BEATS, RADIO_BPM, radioScore } from './radio-score'
import { IDLE_SIGNALS, type DriveAudioSignals } from './signals'

const sig = (over: Partial<DriveAudioSignals>): DriveAudioSignals => ({ ...IDLE_SIGNALS, ...over })

class FakeGraph implements AudioGraphPort {
  time = 0
  levels: AudioLevels[] = []
  notes: ScheduledNote[] = []
  notifies: number[] = []
  state: 'running' | 'suspended' | 'closed' = 'suspended'
  resume = vi.fn(() => {
    this.state = 'running'
    return Promise.resolve()
  })
  suspend = vi.fn(() => {
    this.state = 'suspended'
    return Promise.resolve()
  })
  close = vi.fn(() => {
    this.state = 'closed'
  })
  currentTime(): number {
    return this.time
  }
  setLevels(levels: AudioLevels): void {
    this.levels.push(levels)
  }
  scheduleNotes(notes: readonly ScheduledNote[]): void {
    this.notes.push(...notes)
  }
  playNotify(gain: number): void {
    this.notifies.push(gain)
  }
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value
    },
  }
}

describe('BGM の曲（R5）', () => {
  it('AUD-3f: 同じシード → 同じ音の列。8 小節・84 BPM、音の高さは声部ごとの範囲の中', () => {
    const a = radioScore(1234)
    expect(radioScore(1234)).toEqual(a)
    expect(a.bpm).toBe(RADIO_BPM)
    expect(RADIO_BPM).toBe(84)
    expect(a.bars).toHaveLength(8)
    for (const bar of a.bars) {
      for (const note of bar) {
        expect(note.beat).toBeGreaterThanOrEqual(0)
        expect(note.beat + note.beats).toBeLessThanOrEqual(BAR_BEATS)
        const ranges: Record<string, [number, number]> = {
          bass: [28, 58],
          pad: [52, 79],
          lead: [64, 96],
        }
        const [lo, hi] = ranges[note.voice] ?? [0, 0]
        expect(note.midi).toBeGreaterThanOrEqual(lo)
        expect(note.midi).toBeLessThanOrEqual(hi)
      }
    }
  })

  it('AUD-3f: 別のシードでは曲が変わる', () => {
    const scores = [1, 2, 3, 4, 5].map((seed) => JSON.stringify(radioScore(seed)))
    expect(new Set(scores).size).toBeGreaterThan(1)
  })
})

describe('通知音（R8）', () => {
  it('AUD-3g: 高さの違う 2 音（C6 → F6、60 ms と 90 ms、間 40 ms）', () => {
    expect(NOTIFY_TONES).toHaveLength(2)
    const [first, second] = NOTIFY_TONES
    expect(first?.freqHz).toBeCloseTo(1046.5, 0)
    expect(second?.freqHz).toBeCloseTo(1396.9, 0)
    expect(first?.durS).toBeCloseTo(0.06)
    expect(second?.durS).toBeCloseTo(0.09)
    expect((second?.startS ?? 0) - (first?.durS ?? 0)).toBeCloseTo(0.04)
  })

  it('AUD-3g: 2 秒以内に続けては鳴らさない', () => {
    const gate = new NotifyGate()
    expect(gate.allow(1000)).toBe(true)
    expect(gate.allow(1000 + NOTIFY_MIN_INTERVAL_MS - 1)).toBe(false)
    expect(gate.allow(1000 + NOTIFY_MIN_INTERVAL_MS)).toBe(true)
    gate.reset()
    expect(gate.allow(1000 + NOTIFY_MIN_INTERVAL_MS + 1)).toBe(true)
  })
})

describe('音量の設定（R6）', () => {
  it('AUD-3i: localStorage に残り、壊れた値・読めないときは既定値', () => {
    expect(parseAudioSettings(null)).toEqual({ volume: 60, muted: false, music: true })
    expect(parseAudioSettings('not json')).toEqual({ volume: 60, muted: false, music: true })
    expect(parseAudioSettings('{"volume":"x","muted":1}')).toEqual({
      volume: 60,
      muted: false,
      music: true,
    })
    expect(parseAudioSettings('{"volume":73,"muted":true,"music":false}')).toEqual({
      volume: 70,
      muted: true,
      music: false,
    })
    const storage = memoryStorage({ [SETTINGS_KEY]: '{"volume":30,"muted":false,"music":true}' })
    const store = new AudioSettingsStore(storage)
    expect(store.getSnapshot().volume).toBe(30)
    const listener = vi.fn()
    store.subscribe(listener)
    store.setVolume(85)
    store.toggleMuted()
    store.toggleMusic()
    expect(store.getSnapshot()).toEqual({ volume: 90, muted: true, music: false })
    expect(listener).toHaveBeenCalledTimes(3)
    expect(JSON.parse(storage.data[SETTINGS_KEY] ?? '')).toEqual({
      volume: 90,
      muted: true,
      music: false,
    })
    store.setVolume(-20)
    expect(store.getSnapshot().volume).toBe(0)
  })

  it('AUD-3i: 書けない・読めない storage でも既定値で動く', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    const store = new AudioSettingsStore(broken)
    expect(store.getSnapshot()).toEqual({ volume: 60, muted: false, music: true })
    expect(() => store.setVolume(20)).not.toThrow()
    expect(store.getSnapshot().volume).toBe(20)
    expect(new AudioSettingsStore(null).getSnapshot().volume).toBe(60)
  })
})

describe('音のコントローラ（R7〜R9）', () => {
  function setup() {
    const graph = new FakeGraph()
    let nowMs = 0
    const settings = new AudioSettingsStore(null)
    const audio = new DriveAudio({
      createGraph: () => graph,
      settings,
      seed: 7,
      nowMs: () => nowMs,
    })
    return {
      graph,
      settings,
      audio,
      advance: (ms: number) => {
        nowMs += ms
        graph.time += ms / 1000
      },
    }
  }

  it('AUD-3h: start で音を作り resume する。start の前は何もしない', async () => {
    const { graph, audio } = setup()
    audio.update(sig({ speedKmh: 40 }))
    expect(graph.levels).toHaveLength(0)
    await audio.start()
    expect(graph.resume).toHaveBeenCalledTimes(1)
    audio.update(sig({ speedKmh: 40 }))
    expect(graph.levels).toHaveLength(1)
  })

  it('AUD-3h: 同じ値なら変えない。値が変われば 1 回だけ渡す', async () => {
    const { graph, audio } = setup()
    await audio.start()
    audio.update(sig({ speedKmh: 40 }))
    audio.update(sig({ speedKmh: 40 }))
    audio.update(sig({ speedKmh: 40.0001 }))
    expect(graph.levels).toHaveLength(1)
    audio.update(sig({ speedKmh: 60, throttle: 1 }))
    expect(graph.levels).toHaveLength(2)
  })

  it('AUD-3h: 設定を変えたら最後の合図で値を渡し直す', async () => {
    const { graph, audio, settings } = setup()
    await audio.start()
    audio.update(sig({ speedKmh: 40 }))
    settings.toggleMuted()
    expect(graph.levels.at(-1)?.engine).toBe(0)
  })

  it('AUD-3h: BGM は 1 小節先までを予約し、時間が進むと次の小節を足す', async () => {
    const { graph, audio, advance } = setup()
    await audio.start()
    audio.update(sig({}))
    const firstCount = graph.notes.length
    expect(firstCount).toBeGreaterThan(0)
    const barS = (BAR_BEATS * 60) / RADIO_BPM
    expect(Math.max(...graph.notes.map((n) => n.atS))).toBeLessThan(barS * 2 + 0.01)
    audio.update(sig({}))
    expect(graph.notes.length).toBe(firstCount)
    advance(barS * 1000)
    audio.update(sig({}))
    expect(graph.notes.length).toBeGreaterThan(firstCount)
    // 予約する時刻は今より後
    expect(graph.notes.every((n) => n.atS >= 0)).toBe(true)
  })

  it('AUD-3g: 通知音は 2 秒あけて鳴る。赤の間・消音では鳴らない', async () => {
    const { graph, audio, advance, settings } = setup()
    await audio.start()
    audio.update(sig({}))
    expect(audio.notify()).toBe(true)
    expect(audio.notify()).toBe(false)
    advance(NOTIFY_MIN_INTERVAL_MS)
    audio.update(sig({ alert: 'danger' }))
    expect(audio.notify()).toBe(false)
    audio.update(sig({}))
    settings.toggleMuted()
    expect(audio.notify()).toBe(false)
    expect(graph.notifies).toHaveLength(1)
  })

  it('AUD-3h: タブを隠したら止め、戻したら再開する。dispose で閉じる', async () => {
    const { graph, audio } = setup()
    await audio.start()
    audio.setHidden(true)
    expect(graph.suspend).toHaveBeenCalledTimes(1)
    audio.setHidden(false)
    expect(graph.resume).toHaveBeenCalledTimes(2)
    audio.dispose()
    expect(graph.close).toHaveBeenCalledTimes(1)
    audio.update(sig({ speedKmh: 50 }))
    expect(audio.notify()).toBe(false)
  })

  it('FAIL-44: 音が作れない・resume が拒まれても例外を出さず無音', async () => {
    const settings = new AudioSettingsStore(null)
    const throwing = new DriveAudio({
      createGraph: () => {
        throw new Error('no audio')
      },
      settings,
      seed: 1,
    })
    await expect(throwing.start()).resolves.toBe(false)
    expect(() => throwing.update(sig({ speedKmh: 30 }))).not.toThrow()
    expect(throwing.notify()).toBe(false)

    const graph = new FakeGraph()
    graph.resume = vi.fn(() => Promise.reject(new Error('not allowed')))
    const rejected = new DriveAudio({ createGraph: () => graph, settings, seed: 1 })
    await expect(rejected.start()).resolves.toBe(false)

    const disabled = new DriveAudio({ createGraph: () => null, settings, seed: 1 })
    await expect(disabled.start()).resolves.toBe(false)
  })
})
