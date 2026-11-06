import { pleasureById } from '@antler/trip'
import { describe, expect, it } from 'vitest'
import {
  advanceChat,
  CHAT_GAP_MS,
  initialChatState,
  NO_FILL_BEFORE_ZONE_M,
  type ChatFrame,
  type ChatState,
  type EmittedLine,
} from './advance-chat'
import {
  FALLBACK_PLEASURE_TEXT,
  FILLER_PLEASURE_TEXT,
  RADIO_FILLER_PLEASURE_TEXT,
  RADIO_PLEASURE_TEXT,
} from './chat-text'
import { buildChatTrack, buildFiller } from './chat-track'
import type { ChatDeck, ChatTrack } from './chat-types'

// 観光の行を足す（docs/specs/drive-sound-tourism/functional.md S13〜S15、TOUR-5a〜TOUR-5f）

const L = (ja: string) => ({ ja, en: ja, zh: ja, ko: ja })

const nameOf = (id: string) => {
  const p = pleasureById(id)
  if (!p) throw new Error(`楽しみが無い: ${id}`)
  return p.name
}
const ONSEN = { id: 'akan-onsen-snow', name: nameOf('akan-onsen-snow') }
const KOTAN = { id: 'akan-ainu-kotan', name: nameOf('akan-ainu-kotan') }

const frame = (over: Partial<ChatFrame>): ChatFrame => ({
  t: 0,
  positionKm: 0,
  zoneInterval: null,
  alert: 'safe',
  alertEnabled: true,
  rate: 1,
  toZoneM: null,
  paused: false,
  outcome: 'driving',
  avoidedCount: 0,
  stage: 1,
  ...over,
})

/** 楽しみの行（km 1）と、おやつの行（km 2）の束 */
const DECK: ChatDeck = {
  tripId: 't1',
  day: 1,
  lines: [
    {
      id: 'l01',
      cue: { kind: 'road', leg: 0, km: 1 },
      topic: 'pleasure',
      speaker: 'p1',
      pleasure: ONSEN.id,
      text: L('温泉の話'),
    },
    {
      id: 'l02',
      cue: { kind: 'road', leg: 0, km: 2 },
      topic: 'snack',
      speaker: 'p2',
      pleasure: null,
      text: L('おやつの話'),
    },
  ],
  data: null,
}

function track(
  deck: ChatDeck = DECK,
  pleasures = [
    { ...ONSEN, atM: 50_000 },
    { ...KOTAN, atM: 50_000 },
  ],
  partySize = 3,
): ChatTrack {
  return buildChatTrack(deck, { legStartsM: [0], totalM: 60_000, partySize, seed: 7, pleasures })
}

const EMPTY: ChatDeck = { ...DECK, lines: [] }

/** 実時間 100 ms ごとのフレームを流す。over はフレームの番号から作る */
function drive(
  tr: ChatTrack,
  count: number,
  over: (i: number) => Partial<ChatFrame>,
  start: { state: ChatState; t: number } = { state: initialChatState(), t: 1000 },
) {
  let state = start.state
  let t = start.t
  const out: { i: number; t: number; lines: EmittedLine[] }[] = []
  for (let i = 0; i < count; i++) {
    const o = over(i)
    if (i > 0) t += 100 * (o.rate ?? 1)
    const r = advanceChat(state, tr, frame({ t, ...o }))
    state = r.state
    if (r.emitted.length > 0) out.push({ i, t, lines: r.emitted })
  }
  return { state, t, out }
}

describe('TOUR-5a・TOUR-5f: 過ぎたのに出していない楽しみの行（S13・S15）', () => {
  it('TOUR-5a: ゾーンの外で最後の行から実時間 15 秒で足す。15 秒前は出さない。まだ先の楽しみの行は前倒ししない', () => {
    expect(CHAT_GAP_MS).toBe(15_000)
    const tr = track()
    // 0.5 km にとどまる（楽しみの行 l01 は 1 km でまだ先）
    const { out } = drive(tr, 160, () => ({ positionKm: 0.5 }))
    expect(out).toHaveLength(1)
    // 1 フレーム目は数えないので、151 フレーム目（実時間 15 秒）で出る
    expect(out[0]?.i).toBe(150)
    expect(out[0]?.lines.map((l) => l.text.ja)).not.toContain('温泉の話')
    expect(out[0]?.lines[0]?.text).toEqual(tr.filler[0]?.text)
  })

  it('TOUR-5f・TOUR-5a: ステージを移って飛んだとき、飛ばした楽しみの行は出したことにせず、15 秒後に足す。最後の 1 行は今までどおり出す', () => {
    const tr = track()
    const first = advanceChat(initialChatState(), tr, frame({ t: 1000, positionKm: 0 }))
    // ステージ 2 で 3 km へ飛ぶ: 越えた l01（楽しみ）・l02（おやつ）のうち最後の l02 だけを出す
    const jumped = advanceChat(first.state, tr, frame({ t: 1100, positionKm: 3, stage: 2 }))
    expect(jumped.emitted.map((l) => l.text.ja)).toEqual(['おやつの話'])
    expect(jumped.state.shown.has(tr.road[0]?.id ?? '')).toBe(false)
    const { out } = drive(tr, 310, () => ({ positionKm: 3, stage: 2 }), {
      state: jumped.state,
      t: 1100,
    })
    expect(out[0]?.lines.map((l) => l.text.ja)).toEqual(['温泉の話'])
    expect(out[0]?.lines[0]?.pleasure).toBe(ONSEN.id)
    // 1 度出した楽しみの行は 2 度出さない（次は補いの行）
    expect(out[1]?.lines.map((l) => l.text.ja)).not.toContain('温泉の話')
  })
})

describe('TOUR-5a: 束が替わったとき', () => {
  it('TOUR-5a: 新しい束の、替わった位置より手前の楽しみの行は足さない（補いの行を出す）', () => {
    const before = track()
    const swapped = track({
      ...DECK,
      tripId: 't2',
      lines: [{ ...(DECK.lines[0] ?? DECK.lines[1]!), id: 'l09', text: L('別の束の温泉') }],
    })
    expect(swapped.key).not.toBe(before.key)
    const first = drive(before, 10, () => ({ positionKm: 3 }))
    const { out } = drive(swapped, 160, () => ({ positionKm: 3 }), first)
    const texts = out.flatMap((o) => o.lines.map((l) => l.text.ja))
    expect(texts).not.toContain('別の束の温泉')
    expect(texts.length).toBeGreaterThan(0)
  })
})

describe('TOUR-5b: 実時間（S13）', () => {
  it('TOUR-5b: 実時間は経過の差 ÷ 再生速度の和。16× でも実時間 15 秒。途中で速度を変えても正しい', () => {
    const tr = track()
    const fast = drive(tr, 160, () => ({ positionKm: 0.5, rate: 16 }))
    expect(fast.out[0]?.i).toBe(150)
    // 前半 16×・後半 4×（実時間 7.5 秒ずつ）
    const mixed = drive(tr, 160, (i) => ({ positionKm: 0.5, rate: i <= 75 ? 16 : 4 }))
    expect(mixed.out[0]?.i).toBe(150)
  })
})

describe('TOUR-5c: 足さないとき（S13）', () => {
  const quiet = (over: Partial<ChatFrame>) =>
    drive(track(), 220, () => ({ positionKm: 0.5, ...over })).out

  it('TOUR-5c: ゾーンの中・入口の 300 m 手前から・赤・一時停止・終わりでは足さない', () => {
    // アラート OFF にしてゾーンに入った反応も出さない
    expect(quiet({ zoneInterval: 0, alert: 'zone', alertEnabled: false })).toHaveLength(0)
    expect(quiet({ toZoneM: NO_FILL_BEFORE_ZONE_M })).toHaveLength(0)
    expect(quiet({ toZoneM: NO_FILL_BEFORE_ZONE_M + 1 })).toHaveLength(1)
    expect(quiet({ alert: 'danger' })).toHaveLength(0)
    expect(quiet({ paused: true })).toHaveLength(0)
    expect(quiet({ outcome: 'completed' })).toHaveLength(0)
  })

  it('TOUR-5c: 赤の後で待たせている行がある間は足さない（待たせた行が出てから 15 秒）', () => {
    const tr = track()
    // 0.5 km で赤 → 1.5 km（l01 を越える）→ 赤が終わる
    const red = drive(tr, 30, (i) => ({
      positionKm: i < 20 ? 0.5 : 1.5,
      alert: i < 25 ? 'danger' : 'safe',
    }))
    expect(red.out).toHaveLength(0)
    expect(red.state.held).toHaveLength(1)
    const after = drive(tr, 200, () => ({ positionKm: 1.5 }), { state: red.state, t: red.t })
    // 1.5 秒後に待たせた行、そこから 15 秒後に足す
    expect(after.out[0]?.lines.map((l) => l.text.ja)).toEqual(['温泉の話'])
    expect((after.out[1]?.i ?? 0) - (after.out[0]?.i ?? 0)).toBe(150)
  })
})

describe('TOUR-5d: 補いの行（S14）', () => {
  it('TOUR-5d: 楽しみの行を出し切ったら補いの行を順に出し、全部出したら最初から', () => {
    const tr = track(EMPTY)
    const n = tr.filler.length
    expect(n).toBeGreaterThan(2)
    const { out } = drive(tr, 151 + 150 * n, () => ({ positionKm: 0.5 }))
    const texts = out.map((o) => o.lines[0]?.text)
    expect(texts).toEqual([...tr.filler.map((l) => l.text), tr.filler[0]?.text])
  })

  it('TOUR-5d: 位置を過ぎた楽しみの補いの行は飛ばす。楽しみが無ければ足さない', () => {
    const tr = track(EMPTY, [
      { ...ONSEN, atM: 1000 },
      { ...KOTAN, atM: 50_000 },
    ])
    const { out } = drive(tr, 160 + 150 * 4, () => ({ positionKm: 2 }))
    expect(out.length).toBeGreaterThan(3)
    for (const o of out) expect(o.lines[0]?.pleasure).toBe(KOTAN.id)
    const none = track(EMPTY, [])
    expect(none.filler).toEqual([])
    expect(drive(none, 400, () => ({ positionKm: 0.5 })).out).toHaveLength(0)
  })
})

describe('TOUR-5e: 補いの行の作り方（S14）', () => {
  const places = [
    { ...ONSEN, atM: 10_000 },
    { ...KOTAN, atM: 20_000 },
  ]

  it('TOUR-5e: 楽しみと文の組を順に作り、続けて同じ文にしない', () => {
    const lines = buildFiller(places, 3, 1)
    const table = [...FALLBACK_PLEASURE_TEXT, ...FILLER_PLEASURE_TEXT]
    expect(lines).toHaveLength(places.length * table.length)
    expect(lines.map((l) => l.pleasure).slice(0, 4)).toEqual([
      ONSEN.id,
      KOTAN.id,
      ONSEN.id,
      KOTAN.id,
    ])
    expect(lines[0]?.text).toEqual(table[0]?.(ONSEN.name))
    expect(lines[1]?.text).toEqual(table[1]?.(KOTAN.name))
    expect(lines[2]?.text).toEqual(table[1]?.(ONSEN.name))
    expect(lines[0]?.untilM).toBe(10_000)
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i]?.text.ja).not.toBe(lines[i - 1]?.text.ja)
    }
    // 楽しみが 1 つでも続けて同じ文にしない
    const one = buildFiller([places[0] ?? { ...ONSEN, atM: 0 }], 3, 1)
    for (let i = 1; i < one.length; i++) expect(one[i]?.text.ja).not.toBe(one[i - 1]?.text.ja)
  })

  it('TOUR-5e: 話し手は人数で決まり（続けて同じ人にしない。1 人旅はラジオの言い方）、同じシードで同じ', () => {
    const three = buildFiller(places, 3, 1)
    expect(new Set(three.map((l) => l.speaker))).toEqual(new Set(['p1', 'p2']))
    for (let i = 1; i < three.length; i++) {
      expect(three[i]?.speaker).not.toBe(three[i - 1]?.speaker)
    }
    expect(buildFiller(places, 3, 1)).toEqual(three)
    const solo = buildFiller(places, 1, 1)
    expect(solo.every((l) => l.speaker === 'radio')).toBe(true)
    expect(solo).toHaveLength(
      places.length * (RADIO_PLEASURE_TEXT.length + RADIO_FILLER_PLEASURE_TEXT.length),
    )
    expect(solo[0]?.text).toEqual(RADIO_PLEASURE_TEXT[0]?.(ONSEN.name))
  })
})
