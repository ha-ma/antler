import { describe, expect, it, vi } from 'vitest'
import { AudioSettingsStore, parseAudioSettings, SETTINGS_KEY } from './audio-settings'
import { DriveAudio } from './drive-audio'
import { FakeAudioGraph } from './fake-audio-graph'
import { firstTrackIndex, MUSIC_TRACKS, nextTrackIndex } from './music-tracks'
import {
  NOTIFY_MIN_INTERVAL_MS,
  NOTIFY_TONES,
  NotifyGate,
  ZONE_CHIME_QUIET_MS,
} from './notify-tone'
import { IDLE_SIGNALS, type DriveAudioSignals } from './signals'

const sig = (over: Partial<DriveAudioSignals>): DriveAudioSignals => ({ ...IDLE_SIGNALS, ...over })

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

const url = (index: number) => `/${MUSIC_TRACKS[index]?.file ?? ''}`

describe('BGM の曲の順（R5、drive-sound-tourism S4）', () => {
  it('AUD-3f・SND-1b: 最初の曲はシードで決まる（同じシード → 同じ曲）。終われば次、最後の次は最初', () => {
    expect(firstTrackIndex(1234)).toBe(firstTrackIndex(1234))
    const firsts = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(firstTrackIndex))
    expect(firsts.size).toBeGreaterThan(1)
    for (const i of firsts) expect(i).toBeLessThan(MUSIC_TRACKS.length)
    expect(nextTrackIndex(0)).toBe(1)
    expect(nextTrackIndex(MUSIC_TRACKS.length - 1)).toBe(0)
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

function setup(seed = 7) {
  const graph = new FakeAudioGraph()
  let nowMs = 0
  const settings = new AudioSettingsStore(null)
  const onError = vi.fn()
  const audio = new DriveAudio({
    createGraph: () => graph,
    settings,
    seed,
    nowMs: () => nowMs,
    onError,
  })
  return {
    graph,
    settings,
    audio,
    onError,
    advance: (ms: number) => {
      nowMs += ms
      graph.time += ms / 1000
    },
  }
}

describe('音のコントローラ（R7〜R9）', () => {
  it('AUD-3h: start で音を作り resume する。start の前は何もしない', async () => {
    const { graph, audio } = setup()
    audio.update(sig({ speedKmh: 40 }))
    expect(graph.levels).toHaveLength(0)
    await audio.start()
    expect(graph.resumeCalls).toBe(1)
    audio.update(sig({ speedKmh: 40 }))
    expect(graph.levels.length).toBeGreaterThan(0)
  })

  it('AUD-3h: 同じ値なら変えない。値が変われば 1 回だけ渡す', async () => {
    const { graph, audio } = setup()
    await audio.start()
    audio.update(sig({ speedKmh: 40 }))
    const n = graph.levels.length
    audio.update(sig({ speedKmh: 40 }))
    audio.update(sig({ speedKmh: 40.0001 }))
    expect(graph.levels).toHaveLength(n)
    audio.update(sig({ speedKmh: 60, throttle: 1 }))
    expect(graph.levels).toHaveLength(n + 1)
  })

  it('AUD-3h: 設定を変えたら最後の合図で値を渡し直す', async () => {
    const { graph, audio, settings } = setup()
    await audio.start()
    audio.update(sig({ speedKmh: 40 }))
    settings.toggleMuted()
    expect(graph.levels.at(-1)?.engine).toBe(0)
  })

  it('AUD-3g・SND-3a: 通知音は 2 秒あけて鳴る。赤の間・消音では鳴らない', async () => {
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
    expect(graph.notifies[0]?.tones).toBe(2)
  })

  it('AUD-3h・SND-1e: タブを隠したら止め（曲も一時停止）、戻したら再開する。dispose で閉じる', async () => {
    const { graph, audio } = setup()
    await audio.start()
    audio.setHidden(true)
    expect(graph.suspendCalls).toBe(1)
    expect(graph.playing()).toBeNull()
    audio.setHidden(false)
    expect(graph.resumeCalls).toBe(2)
    expect(graph.playing()).not.toBeNull()
    audio.dispose()
    expect(graph.closeCalls).toBe(1)
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
    expect(throwing.crash()).toBe(false)

    const graph = new FakeAudioGraph()
    graph.resume = () => Promise.reject(new Error('not allowed'))
    const rejected = new DriveAudio({ createGraph: () => graph, settings, seed: 1 })
    await expect(rejected.start()).resolves.toBe(false)
    // 拒まれたら曲も止める
    expect(graph.playing()).toBeNull()

    const disabled = new DriveAudio({ createGraph: () => null, settings, seed: 1 })
    await expect(disabled.start()).resolves.toBe(false)
  })

  it('AUD-3h: 「もう一度」で start を 2 回呼んでも音のグラフは 1 つで、曲は替えない', async () => {
    const graph = new FakeAudioGraph()
    const createGraph = vi.fn(() => graph)
    const audio = new DriveAudio({ createGraph, settings: new AudioSettingsStore(null), seed: 7 })
    await audio.start()
    const first = graph.playing()
    await audio.start()
    expect(createGraph).toHaveBeenCalledTimes(1)
    expect(graph.resumeCalls).toBe(2)
    expect(graph.playing()).toBe(first)
  })
})

describe('BGM（drive-sound-tourism S3〜S7）', () => {
  it('SND-1c: start の前は曲を読み込まない。start でシードの曲を流し、短い音を読み込む', async () => {
    const { graph, audio } = setup(7)
    audio.update(sig({ speedKmh: 40 }))
    expect(graph.music).toHaveLength(0)
    expect(graph.samplesBase).toBeNull()
    await audio.start()
    expect(graph.playing()).toBe(url(firstTrackIndex(7)))
    expect(graph.samplesBase).toBe('/')
  })

  it('SND-1h: 最初の曲は resume() を待つ前に流す（iOS の操作の中）', async () => {
    const graph = new FakeAudioGraph()
    let playingAtResume: string | null = 'not-called'
    graph.resume = () => {
      playingAtResume = graph.playing()
      return Promise.resolve()
    }
    const audio = new DriveAudio({
      createGraph: () => graph,
      settings: new AudioSettingsStore(null),
      seed: 7,
    })
    await audio.start()
    expect(playingAtResume).toBe(url(firstTrackIndex(7)))
  })

  it('SND-1b: 曲が終われば次の曲、最後の次は最初', async () => {
    const { graph, audio } = setup(7)
    await audio.start()
    const first = firstTrackIndex(7)
    graph.emitMusic('ended')
    expect(graph.playing()).toBe(url(nextTrackIndex(first)))
    for (let i = 0; i < MUSIC_TRACKS.length - 1; i++) graph.emitMusic('ended')
    expect(graph.playing()).toBe(url(first))
  })

  it('SND-1d: 赤で BGM の大きさ 0（曲は流したまま）、琥珀 0.6 倍、一時停止は流したまま', async () => {
    const { graph, audio } = setup()
    await audio.start()
    audio.update(sig({ speedKmh: 40 }))
    const cruise = graph.levels.at(-1)?.music ?? 0
    expect(cruise).toBeGreaterThan(0)
    audio.update(sig({ speedKmh: 40, alert: 'zone' }))
    expect(graph.levels.at(-1)?.music).toBeCloseTo(cruise * 0.6)
    audio.update(sig({ speedKmh: 40, alert: 'danger' }))
    expect(graph.levels.at(-1)?.music).toBe(0)
    expect(graph.playing()).not.toBeNull()
    audio.update(sig({ speedKmh: 0, paused: true }))
    expect(graph.playing()).not.toBeNull()
  })

  it('SND-1d: 消音・BGM OFF・走行の終わりで一時停止し、戻したら同じ曲を流す', async () => {
    const { graph, audio, settings } = setup()
    await audio.start()
    audio.update(sig({}))
    const track = graph.playing()
    settings.toggleMuted()
    expect(graph.playing()).toBeNull()
    settings.toggleMuted()
    expect(graph.playing()).toBe(track)
    settings.toggleMusic()
    expect(graph.playing()).toBeNull()
    settings.toggleMusic()
    expect(graph.playing()).toBe(track)
    audio.update(sig({ outcome: 'collided' }))
    expect(graph.playing()).toBeNull()
  })

  it('SND-1f: 再生を拒まれたら BGM なしで続け（記録は 1 回）、次の操作（設定の変更・start）でやり直す', async () => {
    const { graph, audio, settings, onError } = setup()
    graph.blockNextPlay = true
    await audio.start()
    audio.update(sig({ speedKmh: 30 }))
    audio.update(sig({ speedKmh: 31 }))
    expect(graph.playing()).toBeNull()
    expect(onError).toHaveBeenCalledWith('drive.audio.music_failed')
    // 音量の操作は利用者の操作なのでやり直す
    settings.setVolume(50)
    expect(graph.playing()).not.toBeNull()
    // また拒まれても、タブを戻す・合図が来るだけではやり直さない。「もう一度」（start）でやり直す
    graph.blockNextPlay = true
    settings.setVolume(40)
    audio.update(sig({ speedKmh: 30 }))
    audio.setHidden(true)
    audio.setHidden(false)
    expect(graph.playing()).toBeNull()
    await audio.start()
    expect(graph.playing()).not.toBeNull()
    expect(onError.mock.calls.filter((c) => c[0] === 'drive.audio.music_failed')).toHaveLength(1)
  })

  it('SND-1f: 読めない曲は次の曲へ。続けて 3 曲読めなければあきらめる', async () => {
    const { graph, audio, onError } = setup(7)
    await audio.start()
    const first = firstTrackIndex(7)
    graph.emitMusic('error')
    expect(graph.playing()).toBe(url(nextTrackIndex(first)))
    graph.emitMusic('error')
    graph.emitMusic('error')
    expect(graph.playing()).toBeNull()
    audio.update(sig({ speedKmh: 40 }))
    expect(graph.playing()).toBeNull()
    expect(onError).toHaveBeenCalledWith('drive.audio.music_failed')
  })
})

describe('ブレーキの鳴き（drive-sound-tourism S9）', () => {
  it('SND-2c: 全力ブレーキ・20 km/h 以上で鳴き、踏み続ければ 1.1 秒ごと。離して踏み直せばすぐ', async () => {
    const { graph, audio, advance } = setup()
    await audio.start()
    audio.update(sig({ speedKmh: 40, brake: 1 }))
    expect(graph.squeals).toHaveLength(1)
    advance(500)
    audio.update(sig({ speedKmh: 35, brake: 1 }))
    expect(graph.squeals).toHaveLength(1)
    advance(700)
    audio.update(sig({ speedKmh: 30, brake: 1 }))
    expect(graph.squeals).toHaveLength(2)
    audio.update(sig({ speedKmh: 30, brake: 0 }))
    advance(100)
    audio.update(sig({ speedKmh: 30, brake: 1 }))
    expect(graph.squeals).toHaveLength(3)
    // S キー（0.6）・遅いときは鳴かない
    advance(2000)
    audio.update(sig({ speedKmh: 30, brake: 0.6 }))
    audio.update(sig({ speedKmh: 15, brake: 1 }))
    expect(graph.squeals).toHaveLength(3)
  })
})

describe('通知音とチャイム（drive-sound-tourism S11）', () => {
  it('SND-3a: 琥珀では 1 音・0.6 倍。アラート OFF の走行は琥珀でも 2 音', async () => {
    const { graph, audio, advance } = setup()
    await audio.start()
    audio.update(sig({}))
    expect(audio.notify()).toBe(true)
    const green = graph.notifies[0]?.gain ?? 0
    advance(NOTIFY_MIN_INTERVAL_MS)
    audio.update(sig({ alert: 'zone' }))
    advance(ZONE_CHIME_QUIET_MS)
    expect(audio.notify()).toBe(true)
    expect(graph.notifies[1]).toEqual({ gain: green * 0.6, tones: 1 })

    const off = setup()
    await off.audio.start()
    off.audio.update(sig({ alertEnabled: false }))
    off.audio.update(sig({ alertEnabled: false, alert: 'zone' }))
    expect(off.audio.notify()).toBe(true)
    expect(off.graph.notifies[0]?.tones).toBe(2)
  })

  it('SND-3c: 緑から琥珀に入って 2 秒は鳴らさない。2 秒より後は鳴る。赤の後の琥珀は待たない', async () => {
    const { graph, audio, advance } = setup()
    await audio.start()
    audio.update(sig({}))
    audio.update(sig({ alert: 'zone' }))
    advance(ZONE_CHIME_QUIET_MS - 1)
    expect(audio.notify()).toBe(false)
    advance(1)
    expect(audio.notify()).toBe(true)
    advance(NOTIFY_MIN_INTERVAL_MS)
    audio.update(sig({ alert: 'danger' }))
    audio.update(sig({ alert: 'zone' }))
    expect(audio.notify()).toBe(true)
    expect(graph.notifies).toHaveLength(2)
  })
})

describe('衝突の音（drive-sound-tourism S12）', () => {
  it('SND-4a: 衝撃音を 1 回。走行の終わりの後でも鳴る。消音で鳴らさない', async () => {
    const { graph, audio, settings } = setup()
    await audio.start()
    audio.update(sig({ speedKmh: 50, outcome: 'collided' }))
    expect(audio.crash()).toBe(true)
    expect(graph.crashes).toHaveLength(1)
    expect(graph.crashes[0]).toBeGreaterThan(0)

    const muted = setup()
    await muted.audio.start()
    muted.settings.toggleMuted()
    expect(muted.audio.crash()).toBe(false)
    expect(muted.graph.crashes).toHaveLength(0)
    expect(settings.getSnapshot().muted).toBe(false)
  })

  it('SND-4b: 1 回の走行で 1 回。「もう一度」（start）で数え直す', async () => {
    const { graph, audio } = setup()
    await audio.start()
    expect(audio.crash()).toBe(true)
    expect(audio.crash()).toBe(false)
    await audio.start()
    expect(audio.crash()).toBe(true)
    expect(graph.crashes).toHaveLength(2)
  })
})
