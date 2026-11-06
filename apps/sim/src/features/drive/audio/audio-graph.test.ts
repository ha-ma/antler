import { describe, expect, it, vi } from 'vitest'
import { WebAudioGraph } from './audio-graph'
import type { AudioLevels } from './mix'

// jsdom には AudioContext が無いので、使う部分だけのフェイクで配線を確かめる。

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

class FakeContext {
  currentTime = 5
  sampleRate = 8000
  destination = new FakeNode()
  gains: FakeGain[] = []
  oscillators: FakeOscillator[] = []
  resume = vi.fn(() => Promise.resolve())
  suspend = vi.fn(() => Promise.resolve())
  close = vi.fn(() => Promise.resolve())
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
    return new FakeFilter()
  }
  createBufferSource() {
    return new FakeBufferSource()
  }
  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length)
    return { getChannelData: () => data }
  }
}

const LEVELS: AudioLevels = {
  engine: 0.3,
  engineFreqHz: 60,
  brakeNoise: 0.2,
  brakeSqueal: 0.1,
  absHz: 14,
  music: 0.1,
  notify: 0.3,
}

function setup() {
  const ctx = new FakeContext()
  const graph = new WebAudioGraph(() => ctx as unknown as AudioContext)
  return { ctx, graph }
}

describe('Web Audio のグラフ（R2〜R5・R8・R9）', () => {
  it('AUD-3h: 作るとエンジン・ABS・鳴き・雑音の音源が鳴り始め、大きさは 0 から', () => {
    const { ctx } = setup()
    expect(ctx.oscillators.length).toBe(4)
    expect(ctx.oscillators.every((o) => o.started.length === 1)).toBe(true)
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

  it('AUD-3h: 音符と通知音は短い音源を作り、指定の時刻に鳴らして止め、終わったら外す', () => {
    const { ctx, graph } = setup()
    const before = ctx.oscillators.length
    graph.scheduleNotes([{ atS: 6, durS: 0.5, freqHz: 220, voice: 'bass' }])
    const note = ctx.oscillators[before]
    expect(note?.started).toEqual([6])
    expect(note?.stopped[0]).toBeGreaterThan(6.5)
    note?.onended?.()
    expect(note?.disconnect).toHaveBeenCalled()
    graph.playNotify(0.4)
    expect(ctx.oscillators.length).toBe(before + 3)
    const tones = ctx.oscillators.slice(before + 1).map((o) => o.frequency.value)
    expect(tones[0]).toBeCloseTo(1046.5, 0)
  })

  it('AUD-3h: resume・suspend・currentTime は AudioContext に渡し、close は音源を止めて閉じる', async () => {
    const { ctx, graph } = setup()
    await graph.resume()
    await graph.suspend()
    expect(ctx.resume).toHaveBeenCalled()
    expect(ctx.suspend).toHaveBeenCalled()
    expect(graph.currentTime()).toBe(5)
    graph.close()
    expect(ctx.close).toHaveBeenCalled()
    expect(ctx.oscillators.slice(0, 4).every((o) => o.stop.mock.calls.length === 1)).toBe(true)
  })
})
