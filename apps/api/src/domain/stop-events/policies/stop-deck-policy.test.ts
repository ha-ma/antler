import type { DayMaterial, LightAt } from '../models/day-material.js'
import type { StopScene } from '../models/stop-deck.js'
import { buildStopDeck } from './stop-deck-policy.js'

// DECK-1a〜h（docs/specs/stop-events/functional.md R2〜R6）。DayMaterial は手で作る（application のテストで実データを通す）。

const ROAD = { ja: '国道240号', en: 'Route 240', zh: '240號國道', ko: '국도 240호' }
const T = (hhmm: string) => Date.parse(`2027-02-15T${hhmm}:00+09:00`)

/** 16:00 より前は昼、16:00〜17:00 は薄暮、それ以降は夜（テストの光） */
const lightAt: LightAt = (ms) => (ms < T('16:00') ? 'day' : ms < T('17:00') ? 'dusk' : 'night')

/** D2: 釧路 → 鶴居（タンチョウ 重さ 4）→ 阿寒湖。2 つ目の移動に鹿ゾーン */
function material(over: Partial<DayMaterial> = {}): DayMaterial {
  return {
    tripId: 'K7m2abcd',
    seed: 918273,
    day: 2,
    dayCount: 5,
    date: '2027-02-15',
    partySize: 4,
    experience: 'first',
    budgetPerPersonJPY: 120000,
    legs: [
      { from: 'kushiro', to: 'tsurui', departMs: T('08:30'), arriveMs: T('09:30'), distanceKm: 40 },
      { from: 'tsurui', to: 'akan', departMs: T('15:54'), arriveMs: T('17:24'), distanceKm: 75 },
    ],
    zones: [
      {
        leg: 1,
        entryKm: 20,
        exitKm: 58,
        entryMs: T('15:59'),
        entry: { lat: 43.3, lon: 144.2 },
        roadName: ROAD,
      },
    ],
    stops: [{ id: 'red-crowned-crane', base: 'tsurui', weight: 4 }],
    stay: 'akan',
    returnDeadlineMs: null,
    data: { routes: '2026-11-03', zones: 'abc' },
    ...over,
  }
}

function pleasureScenes(scenes: StopScene[]) {
  return scenes.filter((s) => s.kind === 'pleasure')
}

function choice(scene: StopScene | undefined, kind: string) {
  const c = scene?.choices.find((x) => x.kind === kind)
  if (!c) throw new Error(`選択肢 ${kind} が無い`)
  return c
}

describe('buildStopDeck（R2〜R6）', () => {
  it('DECK-1a: 楽しみの場面は stops の順で、beforeLeg はその後に出発する移動。滞在は重さ × 96 分', () => {
    const m = material({
      stops: [
        { id: 'red-crowned-crane', base: 'tsurui', weight: 4 },
        { id: 'lake-akan-onsen', base: 'akan', weight: 1 },
      ],
    })
    const scenes = pleasureScenes(buildStopDeck(m, lightAt).scenes)
    expect(scenes.map((s) => s.pleasure?.id)).toEqual(['red-crowned-crane', 'lake-akan-onsen'])
    expect(scenes.map((s) => s.trigger)).toEqual([
      { kind: 'stop', beforeLeg: 1 },
      { kind: 'stop', beforeLeg: 2 },
    ])
    expect(scenes[0]?.stayMin).toBe(384)
    expect(scenes[0]?.at).toBe('2027-02-15T09:30+09:00')
    expect(scenes[0]?.id).toBe('p-red-crowned-crane')
  })

  it('DECK-1a: 出発地の楽しみ（移動の前）は beforeLeg 0、移動の無い日も 0', () => {
    const atStart = material({ stops: [{ id: 'washo-market', base: 'kushiro', weight: 1 }] })
    expect(pleasureScenes(buildStopDeck(atStart, lightAt).scenes)[0]?.trigger).toEqual({
      kind: 'stop',
      beforeLeg: 0,
    })
    const noLegs = material({
      legs: [],
      zones: [],
      stay: 'kushiro',
      stops: [{ id: 'washo-market', base: 'kushiro', weight: 1 }],
    })
    const deck = buildStopDeck(noLegs, lightAt)
    expect(deck.scenes).toHaveLength(1)
    expect(deck.scenes[0]?.trigger).toEqual({ kind: 'stop', beforeLeg: 0 })
    expect(deck.scenes[0]?.arrive).toBeNull()
  })

  it('DECK-1b: leave（0）・linger（+60）・stay。linger の入口は 60 分後で、光を測り直す', () => {
    const scene = pleasureScenes(buildStopDeck(material(), lightAt).scenes)[0]
    expect(scene?.choices.map((c) => c.kind)).toEqual(['leave', 'linger', 'stay'])
    const leave = choice(scene, 'leave')
    const linger = choice(scene, 'linger')
    expect(leave.zone).toEqual({
      entryAt: '2027-02-15T15:59+09:00',
      light: 'day',
      km: 38,
      roadName: ROAD,
      count: 1,
    })
    expect(linger.delayMin).toBe(60)
    expect(linger.zone?.entryAt).toBe('2027-02-15T16:59+09:00')
    expect(linger.zone?.light).toBe('dusk')
    expect(linger.arrive).toEqual({ place: 'akan', at: '2027-02-15T18:24+09:00' })
    expect(leave.lost).toEqual({ jpy: 0, weight: 0, pleasures: [], lateReturn: false })
  })

  it('DECK-1c: ランダムの数は運転時間 ÷ 経験の間隔の切り捨て、最大 3、1 日 6 場面まで', () => {
    // 運転 150 分: はじめて（120）→ 1、慣れている（180）→ 0
    const random = (m: DayMaterial) =>
      buildStopDeck(m, lightAt).scenes.filter((s) => s.kind !== 'pleasure')
    expect(random(material())).toHaveLength(1)
    expect(random(material({ experience: 'experienced' }))).toHaveLength(0)
    // 運転 600 分 → はじめてでも 3
    const long = material({
      legs: [
        {
          from: 'kushiro',
          to: 'akan',
          departMs: T('07:00'),
          arriveMs: T('17:00'),
          distanceKm: 500,
        },
      ],
      zones: [],
      stops: [],
    })
    expect(random(long)).toHaveLength(3)
    // 楽しみ 5 つ → ランダムは 1 つまで
    const five = material({
      ...long,
      stops: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, base: 'akan', weight: 1 })),
    })
    const deck = buildStopDeck(five, lightAt)
    expect(deck.scenes).toHaveLength(6)
    expect(random(five)).toHaveLength(1)
  })

  it('DECK-1d: ランダムの場面は鹿ゾーンの中に置かず、同じ種類が続かない', () => {
    const zoneEverywhere = material({
      legs: [
        {
          from: 'kushiro',
          to: 'akan',
          departMs: T('07:00'),
          arriveMs: T('17:00'),
          distanceKm: 500,
        },
      ],
      zones: [
        {
          leg: 0,
          entryKm: 10,
          exitKm: 490,
          entryMs: T('07:12'),
          entry: { lat: 43, lon: 144 },
          roadName: ROAD,
        },
      ],
      stops: [],
    })
    for (let seed = 1; seed <= 30; seed++) {
      const scenes = buildStopDeck({ ...zoneEverywhere, seed }, lightAt).scenes
      for (const s of scenes) {
        if (s.trigger.kind !== 'road') throw new Error('road の場面のはず')
        expect(s.trigger.km).toBeLessThanOrEqual(9)
      }
      for (let i = 1; i < scenes.length; i++) expect(scenes[i]?.kind).not.toBe(scenes[i - 1]?.kind)
    }
  })

  it('DECK-1e: 最終日と、その後に鹿ゾーンを通らない場面には泊まる選択肢が無い。どの場面も 2〜3 個', () => {
    const last = buildStopDeck(material({ day: 5, stay: null }), lightAt)
    for (const s of last.scenes) {
      expect(s.choices.some((c) => c.endsDay)).toBe(false)
    }
    const noZone = buildStopDeck(material({ zones: [] }), lightAt)
    for (const s of noZone.scenes) expect(s.choices.some((c) => c.endsDay)).toBe(false)
    for (let seed = 1; seed <= 20; seed++) {
      for (const s of buildStopDeck(material({ seed }), lightAt).scenes) {
        expect(s.choices.length).toBeGreaterThanOrEqual(2)
        expect(s.choices.length).toBeLessThanOrEqual(3)
        expect(new Set(s.choices.map((c) => c.id)).size).toBe(s.choices.length)
      }
    }
  })

  it('DECK-1f: 泊まる系は zone が null、残りの楽しみの重さ、予約した宿が違えば 1 日あたりの予算を失う', () => {
    const m = material({
      stops: [
        { id: 'red-crowned-crane', base: 'tsurui', weight: 4 },
        { id: 'lake-akan-onsen', base: 'akan', weight: 2 },
      ],
    })
    const deck = buildStopDeck(m, lightAt)
    expect(deck.dayBudgetJPY).toBe(96000)
    const stay = choice(pleasureScenes(deck.scenes)[0], 'stay')
    expect(stay).toMatchObject({
      endsDay: true,
      stayAt: 'tsurui',
      arrive: null,
      zone: null,
      lost: { jpy: 96000, weight: 2, pleasures: ['lake-akan-onsen'], lateReturn: false },
    })
    // 予約した宿がその場所なら金額は失わない
    const sameStay = buildStopDeck({ ...m, stay: 'tsurui' }, lightAt)
    expect(choice(pleasureScenes(sameStay.scenes)[0], 'stay').lost.jpy).toBe(0)
  })

  it('DECK-1g: 同じ旅・同じ日 → 同じ束。別の seed → ランダムの場面が変わる', () => {
    const long = material({
      legs: [
        {
          from: 'kushiro',
          to: 'akan',
          departMs: T('07:00'),
          arriveMs: T('17:00'),
          distanceKm: 500,
        },
      ],
      zones: [],
      stops: [],
    })
    expect(buildStopDeck(long, lightAt)).toEqual(buildStopDeck(long, lightAt))
    const variants = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((seed) =>
        JSON.stringify(buildStopDeck({ ...long, seed }, lightAt).scenes),
      ),
    )
    expect(variants.size).toBeGreaterThan(1)
  })

  it('DECK-1h: 支出は 1 日あたりの予算 × 滞在 ÷ 600 分の 100 円単位、到着予定はその日の最後の到着', () => {
    const scene = pleasureScenes(buildStopDeck(material(), lightAt).scenes)[0]
    // 96,000 × 384 / 600 = 61,440 → 61,400
    expect(scene?.spentJPY).toBe(61400)
    expect(scene?.arrive).toEqual({ place: 'akan', at: '2027-02-15T17:24+09:00' })
  })

  it('DECK-1i: 今の移動で鹿ゾーンを通った後のランダムの場面には turn-back が無い', () => {
    // 1 本の長い移動。ゾーンは 5〜15 km と 480〜490 km。場面はその間に落ちる
    const m = material({
      legs: [
        {
          from: 'kushiro',
          to: 'akan',
          departMs: T('07:00'),
          arriveMs: T('17:00'),
          distanceKm: 500,
        },
      ],
      zones: [
        {
          leg: 0,
          entryKm: 5,
          exitKm: 15,
          entryMs: T('07:06'),
          entry: { lat: 43, lon: 144 },
          roadName: ROAD,
        },
        {
          leg: 0,
          entryKm: 480,
          exitKm: 490,
          entryMs: T('16:36'),
          entry: { lat: 43, lon: 144 },
          roadName: ROAD,
        },
      ],
      stops: [],
    })
    let seen = 0
    for (let seed = 1; seed <= 40; seed++) {
      for (const s of buildStopDeck({ ...m, seed }, lightAt).scenes) {
        if (s.kind !== 'traffic' && s.kind !== 'weather') continue
        seen++
        expect(s.choices.map((c) => c.kind)).not.toContain('turn-back')
      }
    }
    expect(seen).toBeGreaterThan(0)
  })

  it('DECK-1j: ゾーンが 2 つ残るとき zone は一番暗いもの、count は残りの数', () => {
    const second = {
      leg: 1,
      entryKm: 70,
      exitKm: 74,
      entryMs: T('16:30'),
      entry: { lat: 43, lon: 144 },
      roadName: { ...ROAD, ja: '国道241号' },
    }
    const m = material({ zones: [...material().zones, second] })
    const scene = pleasureScenes(buildStopDeck(m, lightAt).scenes)[0]
    // leave: 15:59 は昼、16:30 は薄暮 → 2 つ目
    expect(choice(scene, 'leave').zone).toMatchObject({
      entryAt: '2027-02-15T16:30+09:00',
      light: 'dusk',
      km: 4,
      count: 2,
    })
    // linger: 16:59 は薄暮、17:30 は夜 → 2 つ目
    expect(choice(scene, 'linger').zone).toMatchObject({
      entryAt: '2027-02-15T17:30+09:00',
      light: 'night',
    })
    // 同じ暗さなら早いもの
    const sameDark = material({
      zones: [...material().zones, { ...second, entryMs: T('15:30') }],
    })
    expect(
      choice(pleasureScenes(buildStopDeck(sameDark, lightAt).scenes)[0], 'leave').zone?.entryAt,
    ).toBe('2027-02-15T15:30+09:00')
  })

  it('DECK-1k: 最終日に返却の 1 時間前を過ぎる選択肢は lateReturn', () => {
    const m = material({ day: 5, stay: null, returnDeadlineMs: T('18:00') })
    const scene = pleasureScenes(buildStopDeck(m, lightAt).scenes)[0]
    expect(choice(scene, 'leave').lost.lateReturn).toBe(false) // 17:24 着
    expect(choice(scene, 'linger').lost.lateReturn).toBe(true) // 18:24 着
  })

  it('DECK-1l: 同じ拠点の楽しみ 2 つは同じ止まり場所で順に。1 つ目で泊まっても 2 つ目は失わない。移動の無い日は 8:00 から', () => {
    const m = material({
      stops: [
        { id: 'red-crowned-crane', base: 'tsurui', weight: 1 },
        { id: 'tsurui-trail', base: 'tsurui', weight: 1 },
        { id: 'lake-akan-onsen', base: 'akan', weight: 2 },
      ],
    })
    const [a, b] = pleasureScenes(buildStopDeck(m, lightAt).scenes)
    expect(a?.trigger).toEqual({ kind: 'stop', beforeLeg: 1 })
    expect(b?.trigger).toEqual({ kind: 'stop', beforeLeg: 1 })
    expect(a?.at).toBe('2027-02-15T09:30+09:00')
    expect(b?.at).toBe('2027-02-15T11:06+09:00')
    expect(choice(a, 'stay').lost).toMatchObject({ weight: 2, pleasures: ['lake-akan-onsen'] })

    const noLegs = material({
      legs: [],
      zones: [],
      stay: 'kushiro',
      stops: [{ id: 'washo-market', base: 'kushiro', weight: 1 }],
    })
    expect(buildStopDeck(noLegs, lightAt).scenes[0]?.at).toBe('2027-02-15T08:00+09:00')
  })

  it('DECK-1h: ランダムの場面は滞在・支出なし、時刻と道のりは移動の中で比例', () => {
    const scenes = buildStopDeck(material(), lightAt).scenes
    const road = scenes.find((s) => s.kind !== 'pleasure')
    expect(road?.stayMin).toBeNull()
    expect(road?.spentJPY).toBeNull()
    expect(road?.pleasure).toBeNull()
    // 場面は時刻順
    const times = scenes.map((s) => Date.parse(s.at))
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })
})
