import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AlertSoundController,
  beepIntervalMs,
  type AudioPort,
  type SoundUpdate,
} from './sound-controller'

class FakePort implements AudioPort {
  calls: string[] = []
  unlocks = 0
  failBeep = false
  failSpeak = false
  unlock() {
    this.unlocks += 1
    return Promise.resolve()
  }
  playChime() {
    this.calls.push('chime')
  }
  playBeep() {
    if (this.failBeep) throw new Error('AudioContext closed')
    this.calls.push('beep')
  }
  speak(lang: string, text: string) {
    if (this.failSpeak) throw new Error('speechSynthesis unavailable')
    this.calls.push(`speak:${lang}:${text}`)
  }
  cancelSpeech() {
    this.calls.push('cancel')
  }
  count(kind: string) {
    return this.calls.filter((c) => c.startsWith(kind)).length
  }
}

const zone: SoundUpdate = { state: 'zone', distance: 12, lang: 'ja', muted: false }
const safe: SoundUpdate = { state: 'safe', distance: 30, lang: 'ja', muted: false }
const danger = (distance?: number): SoundUpdate => ({
  state: 'danger',
  distance,
  lang: 'ja',
  muted: false,
})

async function ready(port = new FakePort()) {
  const errors: string[] = []
  const c = new AlertSoundController(port, { onError: (event) => errors.push(event) })
  await c.unlock()
  return { c, port, errors }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('UC-5 音（AlertSoundController）', () => {
  it('UC-5a: safe → zone でチャイム 1 回。zone のまま更新しても鳴らない', async () => {
    const { c, port } = await ready()
    c.update(safe)
    c.update(zone)
    c.update({ ...zone, distance: 11 })
    c.update(zone)
    expect(port.count('chime')).toBe(1)
  })

  it('UC-5b: 最初の状態が zone → チャイム 1 回', async () => {
    const { c, port } = await ready()
    c.update(zone)
    expect(port.count('chime')).toBe(1)
  })

  it('UC-5c: safe → danger → zone で 1 回。zone → danger → zone では 2 回目は鳴らない', async () => {
    const a = await ready()
    a.c.update(safe)
    a.c.update(danger(80))
    a.c.update(zone)
    expect(a.port.count('chime')).toBe(1)
    const b = await ready()
    b.c.update(zone)
    b.c.update(danger(80))
    b.c.update(zone)
    expect(b.port.count('chime')).toBe(1)
  })

  it('UC-5d: zone を出て 30 秒以内に入り直す → 鳴らない。30 秒を過ぎて入る → 鳴る', async () => {
    const { c, port } = await ready()
    c.update(zone)
    c.update(safe)
    vi.advanceTimersByTime(29_000)
    c.update(zone)
    expect(port.count('chime')).toBe(1)
    c.update(safe)
    vi.advanceTimersByTime(30_001)
    c.update(zone)
    expect(port.count('chime')).toBe(2)
  })

  it('UC-5e: beepIntervalMs は不明 250・120 m 以上 400・30 m 以下 120・その間は直線', () => {
    expect(beepIntervalMs(undefined)).toBe(250)
    expect(beepIntervalMs(Number.NaN)).toBe(250)
    expect(beepIntervalMs(-1)).toBe(250)
    expect(beepIntervalMs(120)).toBe(400)
    expect(beepIntervalMs(500)).toBe(400)
    expect(beepIntervalMs(30)).toBe(120)
    expect(beepIntervalMs(0)).toBe(120)
    expect(beepIntervalMs(75)).toBeCloseTo(260)
  })

  it('UC-5f: danger の間ビープが間隔どおり繰り返し、danger が解けたら止まる', async () => {
    const { c, port } = await ready()
    c.update(danger(120))
    expect(port.count('beep')).toBe(1)
    vi.advanceTimersByTime(399)
    expect(port.count('beep')).toBe(1)
    vi.advanceTimersByTime(1)
    expect(port.count('beep')).toBe(2)
    c.update(danger(30))
    vi.advanceTimersByTime(400)
    vi.advanceTimersByTime(120)
    expect(port.count('beep')).toBe(4)
    c.update(zone)
    vi.advanceTimersByTime(5_000)
    expect(port.count('beep')).toBe(4)
  })

  it('UC-5g: ビープ 2 回のあとに読み上げ 1 回。2 回目の前に解けたら読まない。同じ danger の間は 2 回目を読まない', async () => {
    const a = await ready()
    a.c.update(danger(58))
    expect(a.port.count('speak')).toBe(0)
    vi.advanceTimersByTime(beepIntervalMs(58))
    expect(a.port.calls).toContain('speak:ja:前方に鹿がいます')
    vi.advanceTimersByTime(10_000)
    expect(a.port.count('speak')).toBe(1)

    const b = await ready()
    b.c.update(danger(58))
    b.c.update(zone)
    vi.advanceTimersByTime(10_000)
    expect(b.port.count('speak')).toBe(0)
  })

  it('UC-5h: muted ならチャイムもビープも読み上げも鳴らない。danger の途中で muted → 次から止まる', async () => {
    const a = await ready()
    a.c.update({ ...zone, muted: true })
    a.c.update({ ...danger(50), muted: true })
    vi.advanceTimersByTime(5_000)
    expect(a.port.calls).toEqual([])

    const b = await ready()
    b.c.update(danger(120))
    b.c.update({ ...danger(120), muted: true })
    vi.advanceTimersByTime(5_000)
    expect(b.port.count('beep')).toBe(1)
  })

  it('UC-5i: 解除前は何も鳴らさず canPlay=false。unlock 後は canPlay=true', async () => {
    const port = new FakePort()
    const c = new AlertSoundController(port)
    expect(c.canPlay).toBe(false)
    c.update(zone)
    c.update(danger(50))
    vi.advanceTimersByTime(2_000)
    expect(port.calls).toEqual([])
    await c.unlock()
    expect(c.canPlay).toBe(true)
  })

  it('S-4: 解除前に始まった danger は、解除された時点から鳴り始める', async () => {
    const port = new FakePort()
    const c = new AlertSoundController(port)
    c.update(danger(50))
    await c.unlock()
    expect(port.count('beep')).toBe(1)
  })
})

describe('resilience', () => {
  it('FAIL-3: 再生が例外を投げても外に出さず、canPlay=false に落としてビープを止める', async () => {
    const port = new FakePort()
    port.failBeep = true
    const { c, errors } = await ready(port)
    expect(() => c.update(danger(50))).not.toThrow()
    expect(c.canPlay).toBe(false)
    expect(errors).toContain('sound.failed')
    vi.advanceTimersByTime(2_000)
    expect(port.count('beep')).toBe(0)
  })

  it('FAIL-4: 読み上げが使えなくてもビープは続く', async () => {
    const port = new FakePort()
    port.failSpeak = true
    const { c, errors } = await ready(port)
    c.update(danger(120))
    vi.advanceTimersByTime(400 * 4)
    expect(port.count('beep')).toBe(5)
    expect(errors).toContain('tts.unavailable')
    expect(c.canPlay).toBe(true)
  })

  it('IDEM-1: 同じ状態で update を 10 回呼んでもチャイムは 1 回', async () => {
    const { c, port } = await ready()
    for (let i = 0; i < 10; i++) c.update(zone)
    expect(port.count('chime')).toBe(1)
  })

  it('IDEM-2: unlock を 2 回（同時にも）呼んでも、出力側の解除は 1 回', async () => {
    const port = new FakePort()
    const c = new AlertSoundController(port)
    await Promise.all([c.unlock(), c.unlock()])
    await c.unlock()
    expect(port.unlocks).toBe(1)
  })

  it('CONC-1: danger → zone → danger を 1 秒以内に繰り返しても古い予約が残らず、読み上げは各 danger で 1 回（前の発話は止める）', async () => {
    const { c, port } = await ready()
    c.update(danger(120))
    vi.advanceTimersByTime(400)
    c.update(zone)
    c.update(danger(120))
    vi.advanceTimersByTime(400)
    c.update(zone)
    vi.advanceTimersByTime(10_000)
    // 1 回目の danger: beep×2 → speak、2 回目: beep×2 → cancel → speak。解けたあとは鳴らない
    expect(port.count('beep')).toBe(4)
    expect(port.count('speak')).toBe(2)
    expect(port.calls.indexOf('cancel')).toBeLessThan(
      port.calls.lastIndexOf('speak:ja:前方に鹿がいます'),
    )
  })
})
