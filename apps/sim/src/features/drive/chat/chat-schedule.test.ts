import { describe, expect, it } from 'vitest'
import { advanceChat, initialChatState, type ChatFrame } from './advance-chat'
import { FALLBACK_TEXT, RADIO_FALLBACK_TEXT, REACTION_TEXT } from './chat-text'
import { buildChatTrack, speakersFor } from './chat-track'
import type { ChatDeck, ChatLine, ChatTrack } from './chat-types'
import { fallbackChatDeck } from './fallback-deck'

const L = (ja: string) => ({ ja, en: ja, zh: ja, ko: ja })

function line(id: string, leg: number, km: number): ChatLine {
  return { id, cue: { kind: 'road', leg, km }, topic: 'scenery', speaker: 'p1', text: L(id) }
}

const DECK: ChatDeck = {
  tripId: 't1',
  day: 1,
  lines: [
    line('l01', 0, 0.2),
    line('l02', 0, 5),
    line('l03', 0, 6),
    line('l04', 0, 7),
    line('l05', 1, 0.2),
  ],
  data: { routes: 'r1', zones: 'z1' },
}
const CTX = { legStartsM: [0, 20_000], totalM: 40_000, partySize: 4, seed: 9 }

const frame = (over: Partial<ChatFrame>): ChatFrame => ({
  t: 0,
  positionKm: 0,
  zoneInterval: null,
  alert: 'safe',
  alertEnabled: true,
  paused: false,
  outcome: 'driving',
  avoidedCount: 0,
  ...over,
})

/** フレームの列を流して、出た行の文（ja）を返す */
function run(track: ChatTrack, frames: Partial<ChatFrame>[]) {
  let state = initialChatState()
  const out: string[][] = []
  for (const f of frames) {
    const r = advanceChat(state, track, frame(f))
    state = r.state
    out.push(r.emitted.map((e) => e.text.ja))
  }
  return { out, state }
}

describe('会話の道のりへの写し（R12・R19）', () => {
  it('CHAT-4j: 行の道のりは移動の始まり + km。次の移動の始まり − 1 km で抑える', () => {
    const track = buildChatTrack(
      { ...DECK, lines: [line('a', 0, 0.2), line('b', 0, 25), line('c', 1, 3)] },
      CTX,
    )
    expect(track.road.map((r) => [r.id, r.atM])).toEqual([
      ['a', 200],
      ['b', 19_000],
      ['c', 23_000],
    ])
  })

  it('CHAT-4f: 話し手は人数で決まる（1 人旅は radio、最大 3 人）', () => {
    expect(speakersFor(1)).toEqual(['radio'])
    expect(speakersFor(2)).toEqual(['p1'])
    expect(speakersFor(4)).toEqual(['p1', 'p2', 'p3'])
    expect(speakersFor(8)).toEqual(['p1', 'p2', 'p3'])
    const solo = buildChatTrack(DECK, { ...CTX, partySize: 1 })
    expect(
      Object.values(solo.reactions)
        .flat()
        .every((r) => r.speaker === 'radio'),
    ).toBe(true)
    expect(solo.reactions['zone-enter'][0].text).toEqual(REACTION_TEXT['zone-enter'][0])
  })
})

describe('出すタイミング（R12）', () => {
  const track = buildChatTrack(DECK, CTX)

  it('CHAT-4a: 道のりを越えたら出る。一度に越えた行は道のりの順', () => {
    const { out } = run(track, [
      { t: 0, positionKm: 0 },
      { t: 100, positionKm: 0.1 },
      { t: 200, positionKm: 0.25 },
      { t: 300, positionKm: 4 },
      { t: 400, positionKm: 7.5 },
    ])
    expect(out).toEqual([[], [], ['l01'], [], ['l02', 'l03', 'l04']])
  })

  it('CHAT-4a: 後退して戻っても同じ行は 1 回だけ', () => {
    const { out } = run(track, [
      { t: 0, positionKm: 0 },
      { t: 100, positionKm: 0.3 },
      { t: 200, positionKm: 0.1 },
      { t: 300, positionKm: 0.3 },
    ])
    expect(out.flat()).toEqual(['l01'])
  })

  it('CHAT-4b: ゾーンに入って 2.5 秒後に zone-enter、出たら zone-exit。区間ごとに 1 回。n 回目は (n − 1) mod 2', () => {
    const enter = REACTION_TEXT['zone-enter']
    const exit = REACTION_TEXT['zone-exit']
    const { out } = run(track, [
      { t: 0, positionKm: 1 },
      { t: 1000, positionKm: 1.1, zoneInterval: 0 },
      { t: 3400, positionKm: 1.2, zoneInterval: 0 },
      { t: 3500, positionKm: 1.3, zoneInterval: 0 },
      { t: 3600, positionKm: 1.4, zoneInterval: null },
      // 入口の前後を行き来しても繰り返さない
      { t: 3700, positionKm: 1.35, zoneInterval: 0 },
      { t: 7000, positionKm: 1.4, zoneInterval: null },
      // 2 つ目の区間
      { t: 8000, positionKm: 2, zoneInterval: 1 },
      { t: 10_600, positionKm: 2.1, zoneInterval: 1 },
      { t: 11_000, positionKm: 2.2, zoneInterval: null },
    ])
    expect(out).toEqual([
      [],
      [],
      [],
      [enter[0].ja],
      [exit[0].ja],
      [],
      [],
      [],
      [enter[1].ja],
      [exit[1].ja],
    ])
  })

  it('CHAT-4b: avoided の遭遇が増えるごとに avoided の行', () => {
    const avoided = REACTION_TEXT.avoided
    const { out } = run(track, [
      { t: 0, positionKm: 1 },
      { t: 100, positionKm: 1, avoidedCount: 1 },
      { t: 200, positionKm: 1, avoidedCount: 3 },
    ])
    expect(out).toEqual([[], [avoided[0].ja], [avoided[1].ja, avoided[0].ja]])
  })

  it('CHAT-4k: アラート OFF の走行では zone-enter・zone-exit を出さず、avoided は出す', () => {
    const { out } = run(track, [
      { t: 0, positionKm: 1, alertEnabled: false },
      { t: 100, positionKm: 1.1, zoneInterval: 0, alertEnabled: false },
      { t: 3000, positionKm: 1.2, zoneInterval: 0, alertEnabled: false },
      { t: 3100, positionKm: 1.3, zoneInterval: null, alertEnabled: false, avoidedCount: 1 },
    ])
    expect(out).toEqual([[], [], [], [REACTION_TEXT.avoided[0].ja]])
  })

  it('CHAT-4c: 赤の間の行は待たせ、赤が終わって 1.5 秒後にまとめて出る（新しい 3 行まで）', () => {
    const { out } = run(track, [
      { t: 0, positionKm: 0 },
      { t: 100, positionKm: 0.1, alert: 'danger' },
      { t: 200, positionKm: 7.5, alert: 'danger' },
      { t: 300, positionKm: 7.6, alert: 'safe' },
      { t: 1700, positionKm: 7.7 },
      { t: 1800, positionKm: 7.8 },
    ])
    expect(out).toEqual([[], [], [], [], [], ['l02', 'l03', 'l04']])
  })

  it('CHAT-4c: 待ちの間にまた赤が来たら、終わってから 1.5 秒を数え直す', () => {
    const { out } = run(track, [
      { t: 0, positionKm: 0 },
      { t: 100, positionKm: 0.3, alert: 'danger' },
      { t: 200, positionKm: 0.3 },
      { t: 1200, positionKm: 0.3, alert: 'danger' },
      { t: 1300, positionKm: 0.3 },
      { t: 1799, positionKm: 0.3 },
      { t: 2800, positionKm: 0.3 },
      { t: 2900, positionKm: 0.3 },
    ])
    expect(out).toEqual([[], [], [], [], [], [], ['l01'], []])
  })

  it('CHAT-4d: 一時停止の間・走行の終わりの後は出さない。restart（t が戻る）で最初から', () => {
    const paused = run(track, [
      { t: 0, positionKm: 0 },
      { t: 100, positionKm: 0.3, paused: true },
      { t: 100, positionKm: 0.3 },
    ])
    expect(paused.out).toEqual([[], [], ['l01']])
    const ended = run(track, [
      { t: 0, positionKm: 0 },
      { t: 100, positionKm: 0.3, outcome: 'collided' },
    ])
    expect(ended.out.flat()).toEqual([])
    const restarted = run(track, [
      { t: 0, positionKm: 0 },
      { t: 5000, positionKm: 0.3 },
      { t: 0, positionKm: 0 },
      { t: 100, positionKm: 0.3 },
    ])
    expect(restarted.out).toEqual([[], ['l01'], [], ['l01']])
  })

  it('CHAT-4e: 束が替わったら、替わった時点より先の行だけを新しい束から出し、待ち行列は捨てる', () => {
    const next = buildChatTrack(
      {
        ...DECK,
        data: { routes: 'r1', zones: 'z2' },
        lines: [line('n01', 0, 0.2), line('n02', 0, 6)],
      },
      CTX,
    )
    let state = initialChatState()
    const step = (t: ChatTrack, f: Partial<ChatFrame>) => {
      const r = advanceChat(state, t, frame(f))
      state = r.state
      return r.emitted.map((e) => e.text.ja)
    }
    step(track, { t: 0, positionKm: 0 })
    expect(step(track, { t: 100, positionKm: 5.5, alert: 'danger' })).toEqual([])
    // 替わった: l01・l02 の待ちは捨てる。n01（0.2 km）は過ぎているので出さない
    expect(step(next, { t: 200, positionKm: 5.5 })).toEqual([])
    expect(step(next, { t: 2000, positionKm: 6.5 })).toEqual(['n02'])
  })
})

describe('見本の会話（R19）', () => {
  const zones: [number, number][] = [[24, 31]]
  const deck = fallbackChatDeck({
    tripId: 'demo',
    day: 1,
    legStartsM: [0, 50_000],
    totalM: 62_000,
    zonesKm: zones,
    partySize: 4,
    seed: 5,
  })

  it('CHAT-4f: 各移動の 0.2 km に depart、20 km ごとの行はゾーンの外、話し手は人数から', () => {
    const departs = deck.lines.filter((l) => l.topic === 'depart')
    expect(departs.map((l) => [l.cue.leg, l.cue.km])).toEqual([
      [0, 0.2],
      [1, 0.2],
    ])
    const track = buildChatTrack(deck, {
      legStartsM: [0, 50_000],
      totalM: 62_000,
      partySize: 4,
      seed: 5,
    })
    for (const r of track.road) {
      expect(zones.every(([a, b]) => r.atM / 1000 < a || r.atM / 1000 > b)).toBe(true)
    }
    // 1 本目（50 km）: 20 km と 40 km（どちらもゾーン 24〜31 km の外）。2 本目（12 km）は depart だけ
    const leg0 = deck.lines
      .filter((l) => l.cue.leg === 0 && l.topic !== 'depart')
      .map((l) => l.cue.km)
    expect(leg0).toEqual([20, 40])
    expect(deck.lines.every((l) => ['p1', 'p2', 'p3'].includes(l.speaker))).toBe(true)
    expect(deck.data).toBeNull()
  })

  it('CHAT-4f: ゾーンの中に落ちた行は入口の 1 km 手前に動き、近すぎれば作らない', () => {
    const inZone = fallbackChatDeck({
      tripId: 'demo',
      day: 1,
      legStartsM: [0],
      totalM: 45_000,
      zonesKm: [
        [18, 22],
        [39, 44],
      ],
      partySize: 2,
      seed: 1,
    })
    // 20 km → 17 km、40 km → 38 km
    expect(inZone.lines.filter((l) => l.topic !== 'depart').map((l) => l.cue.km)).toEqual([17, 38])
    expect(inZone.lines.every((l) => l.speaker === 'p1')).toBe(true)
  })

  it('CHAT-4f: 文は固定の表から、数字・絵文字・鹿の語が無く、4 言語そろう', () => {
    const all = [...Object.values(FALLBACK_TEXT).flat(), ...Object.values(REACTION_TEXT).flat()]
    expect(all).toHaveLength(18)
    for (const text of all) {
      for (const value of Object.values(text)) {
        expect(value.length).toBeGreaterThan(0)
        expect(value).not.toMatch(/[0-9０-９]/)
        expect(value).not.toMatch(/\p{Extended_Pictographic}/u)
        expect(value).not.toMatch(/鹿|シカ|deer|사슴/i)
      }
      expect(Object.keys(text).sort()).toEqual(['en', 'ja', 'ko', 'zh'])
    }
  })

  it('CHAT-4f: 同じ種 → 同じ見本の会話', () => {
    const again = fallbackChatDeck({
      tripId: 'demo',
      day: 1,
      legStartsM: [0, 50_000],
      totalM: 62_000,
      zonesKm: zones,
      partySize: 4,
      seed: 5,
    })
    expect(again).toEqual(deck)
  })

  it('CHAT-4f: 1 人旅はラジオの DJ の文（同乗者の言い方をさせない）', () => {
    const solo = fallbackChatDeck({
      tripId: 'demo',
      day: 1,
      legStartsM: [0],
      totalM: 70_000,
      zonesKm: [],
      partySize: 1,
      seed: 2,
    })
    expect(solo.lines.every((l) => l.speaker === 'radio')).toBe(true)
    expect(solo.lines.map((l) => l.text)).toEqual(RADIO_FALLBACK_TEXT.slice(0, solo.lines.length))
    for (const text of RADIO_FALLBACK_TEXT) {
      for (const value of Object.values(text)) expect(value).not.toMatch(/[0-9０-９]|鹿|deer/i)
    }
  })
})

describe('出すタイミングの端（レビューの指摘）', () => {
  it('CHAT-4e: 見本と api の束の id が同じでも、替わった時点より先の api の行は出る', () => {
    const local = buildChatTrack(
      { ...DECK, data: null, lines: [line('l01', 0, 0.2), line('l02', 0, 3)] },
      CTX,
    )
    const api = buildChatTrack({ ...DECK, lines: [line('l01', 0, 0.2), line('l02', 0, 5)] }, CTX)
    let state = initialChatState()
    const step = (t: ChatTrack, f: Partial<ChatFrame>) => {
      const r = advanceChat(state, t, frame(f))
      state = r.state
      return r.emitted.map((e) => e.text.ja)
    }
    step(local, { t: 0, positionKm: 0 })
    expect(step(local, { t: 100, positionKm: 3.5 })).toEqual(['l01', 'l02'])
    expect(step(api, { t: 200, positionKm: 4 })).toEqual([])
    expect(step(api, { t: 300, positionKm: 5.5 })).toEqual(['l02'])
  })

  it('CHAT-4b: 2.5 秒の前にゾーンを出たら、入った行も出た行も出さない', () => {
    const track = buildChatTrack(DECK, CTX)
    const { out } = run(track, [
      { t: 0, positionKm: 1 },
      { t: 100, positionKm: 1.1, zoneInterval: 0 },
      { t: 2000, positionKm: 1.2, zoneInterval: null },
      { t: 5000, positionKm: 1.3, zoneInterval: null },
    ])
    expect(out.flat()).toEqual([])
  })

  it('CHAT-4c: 赤の後の放出のフレームで来た行も、待たせた行と一緒に落とさず出す', () => {
    const track = buildChatTrack(DECK, CTX)
    const { out } = run(track, [
      { t: 0, positionKm: 0 },
      { t: 100, positionKm: 6.5, alert: 'danger' },
      { t: 200, positionKm: 6.5 },
      { t: 1700, positionKm: 7.5 },
    ])
    expect(out.at(-1)).toEqual(['l01', 'l02', 'l03', 'l04'])
    expect(out.slice(0, -1).flat()).toEqual([])
  })

  it('CHAT-4d: restart は reset を返す', () => {
    const track = buildChatTrack(DECK, CTX)
    const first = advanceChat(initialChatState(), track, frame({ t: 5000, positionKm: 1 }))
    expect(first.reset).toBe(false)
    const again = advanceChat(first.state, track, frame({ t: 0, positionKm: 0 }))
    expect(again.reset).toBe(true)
  })
})
