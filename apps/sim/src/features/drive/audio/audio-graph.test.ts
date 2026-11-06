import { describe, expect, it, vi } from 'vitest'
import { noiseSamples, WebAudioGraph, type MusicEvent } from './audio-graph'
import type { AudioLevels } from './mix'

// jsdom には AudioContext が無いので、使う部分だけのフェイクで配線を確かめる（音は出さない）。

class FakeParam {
  value = 1
  targets: { value: number; at: number }[] = []
  setTargetAtTime = vi.fn((value: number, at: number) => {
    this.targets.push({ value, at })
    return this
  })
  setValueAtTime = vi.fn((value: number) => {
    this.value = value
    return this
  })
  linearRampToValueAtTime = vi.fn(() => this)
  exponentialRampToValueAtTime = vi.fn(() => this)
}

class FakeNode {
  connections: unknown[] = []
  connect = vi.fn((to: unknown) => {
    this.connections.push(to)
    return to
  })
  disconnect = vi.fn()
}

class FakeGain extends FakeNode {
  gain = new FakeParam()
}

class FakeFilter extends FakeNode {
  type = 'lowpass'
  frequency = new FakeParam()
  Q = new FakeParam()
}

class FakeSource extends FakeNode {
  started: number[] = []
  stopped: number[] = []
  onended: (() => void) | null = null
  start = vi.fn((at = 0) => {
    this.started.push(at)
  })
  stop = vi.fn((at = 0) => {
    this.stopped.push(at)
  })
}

class FakeOscillator extends FakeSource {
  type = 'sine'
  frequency = new FakeParam()
}

class FakeBufferSource extends FakeSource {
  buffer: unknown = null
  loop = false
}

/** <audio> のフェイク（play・pause・src・出来事） */
class FakeMedia {
  src = ''
  preload = ''
  paused = true
  /** play() を拒むときの例外の名前（null なら拒まない） */
  rejectPlay: string | null = null
  plays = 0
  private readonly handlers = new Map<string, () => void>()
  play = vi.fn(() => {
    this.plays += 1
    if (this.rejectPlay) {
      return Promise.reject(new DOMException('play() failed', this.rejectPlay))
    }
    this.paused = false
    return Promise.resolve()
  })
  pause = vi.fn(() => {
    this.paused = true
  })
  load = vi.fn()
  removeAttribute = vi.fn((name: string) => {
    if (name === 'src') this.src = ''
  })
  addEventListener(type: string, handler: () => void) {
    this.handlers.set(type, handler)
  }
  fire(type: string) {
    this.handlers.get(type)?.()
  }
}

class FakeContext {
  currentTime = 5
  sampleRate = 8000
  destination = new FakeNode()
  gains: FakeGain[] = []
  oscillators: FakeOscillator[] = []
  filters: FakeFilter[] = []
  bufferSources: FakeBufferSource[] = []
  mediaSources: FakeNode[] = []
  resume = vi.fn(() => Promise.resolve())
  suspend = vi.fn(() => Promise.resolve())
  close = vi.fn(() => Promise.resolve())
  decodeAudioData = vi.fn((bytes: ArrayBuffer) => Promise.resolve({ bytes }))
  createGain() {
    const g = new FakeGain()
    this.gains.push(g)
    return g
  }
  createOscillator() {
    const o = new FakeOscillator()
    this.oscillators.push(o)
    return o
  }
  createBiquadFilter() {
    const f = new FakeFilter()
    this.filters.push(f)
    return f
  }
  createBufferSource() {
    const s = new FakeBufferSource()
    this.bufferSources.push(s)
    return s
  }
  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length)
    return { getChannelData: () => data }
  }
  createMediaElementSource() {
    const n = new FakeNode()
    this.mediaSources.push(n)
    return n
  }
}

const LEVELS: AudioLevels = {
  engine: 0.3,
  engineFreqHz: 60,
  brakeNoise: 0.2,
  brakeSqueal: 0.1,
  absHz: 14,
  music: 0.1,
  musicOn: true,
  notify: 0.3,
  notifyTones: 2,
  crash: 0.6,
}

function setup(
  fetchBytes: (url: string) => Promise<ArrayBuffer> = () => Promise.resolve(new ArrayBuffer(8)),
) {
  const ctx = new FakeContext()
  const medias: FakeMedia[] = []
  const graph = new WebAudioGraph({
    createContext: () => ctx as unknown as AudioContext,
    createMedia: () => {
      const m = new FakeMedia()
      medias.push(m)
      return m as unknown as HTMLAudioElement
    },
    fetchBytes,
  })
  const events: MusicEvent[] = []
  graph.onMusicEvent((e) => events.push(e))
  return { ctx, graph, medias, events }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('Web Audio のグラフ（R2〜R4・R8、drive-sound-tourism S1〜S12）', () => {
  it('AUD-3h: 作るとエンジン・ABS の音源と雑音が鳴り始め、大きさは 0 から。合成の鳴き・ラジオの雑音は無い', () => {
    const { ctx } = setup()
    // エンジン 2・ABS の LFO 1（1.8 kHz の正弦波の鳴きは無くした）
    expect(ctx.oscillators.length).toBe(3)
    expect(ctx.oscillators.every((o) => o.started.length === 1)).toBe(true)
    // ループの雑音はブレーキのこすれの 1 つだけ（ラジオの雑音を混ぜない）
    expect(ctx.bufferSources.filter((s) => s.loop)).toHaveLength(1)
  })

  it('SND-1g・SND-2b: こすれは 900 Hz の帯域。曲を帯域で絞らない（高域・低域のフィルタはエンジンとこすれだけ）', () => {
    const { ctx } = setup()
    const band = ctx.filters.find((f) => f.type === 'bandpass')
    expect(band?.frequency.value).toBe(900)
    expect(band?.Q.value).toBeCloseTo(0.7)
    expect(ctx.filters.filter((f) => f.type === 'highpass')).toHaveLength(0)
    expect(ctx.filters).toHaveLength(2)
  })

  it('SND-2a: 雑音は縮退しない（2 秒の中の値がほぼすべて違う）。同じ種で同じ雑音', () => {
    const a = noiseSamples(88_200)
    expect(new Set(a).size).toBeGreaterThan(88_200 * 0.99)
    expect(noiseSamples(1000)).toEqual(a.slice(0, 1000))
    expect(Math.max(...a.slice(0, 5000).map(Math.abs))).toBeLessThanOrEqual(0.9)
  })

  it('AUD-3h: setLevels は setTargetAtTime でならして値を渡す。ABS は断続の深さを付ける', () => {
    const { ctx, graph } = setup()
    graph.setLevels(LEVELS)
    const engineOsc = ctx.oscillators[0]
    expect(engineOsc?.frequency.targets.at(-1)).toEqual({ value: 60, at: 5 })
    const targets = ctx.gains.flatMap((g) => g.gain.targets.map((t) => t.value))
    expect(targets).toEqual(expect.arrayContaining([0.3, 0.2, 0.1]))
    // ABS: 断続の深さ 0.5
    expect(ctx.gains.some((g) => g.gain.value === 0.5)).toBe(true)
    graph.setLevels({ ...LEVELS, absHz: 0 })
    expect(ctx.gains.some((g) => g.gain.setValueAtTime.mock.calls.at(-1)?.[0] === 0)).toBe(true)
  })

  it('SND-1c・SND-1h: 曲は <audio> を 1 つだけ作り、BGM の大きさにつなぐ。同じ URL は続きから、別の URL は src を替える。null で一時停止', () => {
    const { ctx, graph, medias } = setup()
    expect(medias).toHaveLength(0)
    graph.setMusic('/audio/music/a.mp3')
    expect(medias).toHaveLength(1)
    const media = medias[0]
    expect(media?.src).toBe('/audio/music/a.mp3')
    expect(media?.preload).toBe('auto')
    expect(media?.plays).toBe(1)
    expect(ctx.mediaSources).toHaveLength(1)
    graph.setMusic('/audio/music/a.mp3')
    expect(media?.plays).toBe(1)
    graph.setMusic(null)
    expect(media?.paused).toBe(true)
    graph.setMusic('/audio/music/b.mp3')
    expect(medias).toHaveLength(1)
    expect(ctx.mediaSources).toHaveLength(1)
    expect(media?.src).toBe('/audio/music/b.mp3')
    expect(media?.plays).toBe(2)
  })

  it('SND-1f: 再生を拒まれたら blocked、終わり・読めないは ended・error を知らせる。<audio> をつなげなければ blocked', async () => {
    const { graph, medias, events } = setup()
    graph.setMusic('/a.mp3')
    medias[0]?.fire('ended')
    medias[0]?.fire('error')
    expect(events).toEqual(['ended', 'error'])
    // 読み込み中の pause（AbortError）・読めない曲（NotSupportedError）は blocked にしない（code-reviewer C1）
    const media = medias[0]
    for (const name of ['AbortError', 'NotSupportedError']) {
      graph.setMusic(null)
      if (media) media.rejectPlay = name
      graph.setMusic('/a.mp3')
      await flush()
    }
    expect(events).toEqual(['ended', 'error'])
    graph.setMusic(null)
    if (media) media.rejectPlay = 'NotAllowedError'
    graph.setMusic('/a.mp3')
    await flush()
    expect(events.at(-1)).toBe('blocked')

    const broken = setup()
    ;(broken.ctx as unknown as { createMediaElementSource: () => never }).createMediaElementSource =
      () => {
        throw new Error('not supported')
      }
    expect(() => broken.graph.setMusic('/a.mp3')).not.toThrow()
    expect(broken.events).toEqual(['blocked'])
  })

  it('SND-2c・SND-4a: 短い音は読み込んだ後に鳴らす（鳴きは ABS の断続の出口、衝突は全体へ。衝突は自作のドスンも）。読めない音は鳴らさない', async () => {
    const urls: string[] = []
    const { ctx, graph } = setup((u) => {
      urls.push(u)
      return u.includes('crash')
        ? Promise.reject(new Error('404'))
        : Promise.resolve(new ArrayBuffer(8))
    })
    graph.playSqueal(0.5)
    const before = ctx.bufferSources.length
    graph.loadSamples('/base/')
    graph.loadSamples('/base/')
    expect(urls).toEqual(['/base/audio/sfx/tire-squeal.mp3', '/base/audio/sfx/crash.mp3'])
    await flush()
    graph.playSqueal(0.5)
    const squeal = ctx.bufferSources[before]
    expect(squeal?.started).toHaveLength(1)
    graph.playSqueal(0)
    expect(ctx.bufferSources.length).toBe(before + 1)
    // 衝突: 録音は読めなかったので鳴らさないが、自作のドスン（下がる正弦波と低域の雑音）は鳴らす
    const oscBefore = ctx.oscillators.length
    graph.playCrash(0.8)
    expect(ctx.oscillators.length).toBe(oscBefore + 1)
    const thud = ctx.oscillators.at(-1)
    expect(thud?.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(
      35,
      expect.any(Number),
    )
    expect(ctx.bufferSources.length).toBe(before + 2)
    thud?.onended?.()
    expect(thud?.disconnect).toHaveBeenCalled()
  })

  it('AUD-3h・SND-3a: 通知音は短い音源を作り、指定の時刻に鳴らして止め、終わったら外す。音の数を選べる', () => {
    const { ctx, graph } = setup()
    const before = ctx.oscillators.length
    graph.playNotify(0.4, 2)
    expect(ctx.oscillators.length).toBe(before + 2)
    const tone = ctx.oscillators[before]
    expect(tone?.frequency.value).toBeCloseTo(1046.5, 0)
    expect(tone?.stopped[0]).toBeGreaterThan(5)
    tone?.onended?.()
    expect(tone?.disconnect).toHaveBeenCalled()
    graph.playNotify(0.4, 1)
    expect(ctx.oscillators.length).toBe(before + 3)
  })

  it('AUD-3h・SND-1e: resume・suspend・currentTime は AudioContext に渡し、close は音源と曲を止めて閉じる', async () => {
    const { ctx, graph, medias, events } = setup()
    graph.setMusic('/a.mp3')
    await graph.resume()
    await graph.suspend()
    expect(ctx.resume).toHaveBeenCalled()
    expect(ctx.suspend).toHaveBeenCalled()
    expect(graph.currentTime()).toBe(5)
    graph.close()
    expect(ctx.close).toHaveBeenCalled()
    expect(ctx.oscillators.slice(0, 3).every((o) => o.stop.mock.calls.length === 1)).toBe(true)
    expect(medias[0]?.paused).toBe(true)
    expect(medias[0]?.src).toBe('')
    // 閉じた後の <audio> の出来事は知らせない
    medias[0]?.fire('error')
    expect(events).toEqual([])
  })
})
