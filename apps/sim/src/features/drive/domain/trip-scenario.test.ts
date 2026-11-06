import type { TripPlan } from '@antler/schema'
import {
  assessRisk,
  buildDayPlan,
  buildItinerary,
  buildTripPlan,
  PERSONA_INPUT,
  type DayPlan,
} from '@antler/trip'
import { ROAD_CATALOG } from '@antler/trip/roads'
import { measureAlongRoute, metersBetween, planRoute, type LonLat } from '@antler/zones'
import { describe, expect, it } from 'vitest'
import { createCandidates } from './deer-spawn'
import { createRoadFrame, lonLatAt } from './road'
import { driveSeed } from './scenario'
import { advance, createWorld, driveResult, setInput } from './simulation'
import { scenarioFromDay } from './trip-scenario'
import { withoutRanges, zoneStatusFromS } from './zone-status'
import { ZONES } from './zones-data'
import { NO_INPUT } from '../types'

// drive-link: 旅のその日（GET /api/trips/:id/day/:n の応答と同じもの）から運転の場面を作る。
// 応答は api と同じ純粋関数（@antler/trip の buildDayPlan）で作る。

function personaPlan(seed = 918273): TripPlan {
  const itinerary = buildItinerary(PERSONA_INPUT)
  return buildTripPlan(PERSONA_INPUT, itinerary, assessRisk(PERSONA_INPUT, itinerary), {
    id: 'K7m2abcd',
    seed,
    title: '流氷とタンチョウの道東',
  })
}

const plan = personaPlan()
const dayOf = (n: number, p = plan): DayPlan =>
  buildDayPlan({ plan: p, day: n, roads: ROAD_CATALOG, zones: ZONES })
const day1 = dayOf(1)

/** 2 つの移動の DayPlan を作る（1 日目の線を半分で切って 2 つにする） */
function twoLegs(gapM = 0, uTurn = false): DayPlan {
  const leg = day1.legs[0]
  if (!leg) throw new Error('1 日目に移動がない')
  const mid = Math.floor(leg.route.length / 2)
  const a = leg.route.slice(0, mid + 1)
  let b = leg.route.slice(mid)
  if (uTurn) b = [...a].reverse()
  if (gapM > 0) b = b.map(([lon, lat]) => [lon, lat + gapM / 111_000] as [number, number])
  return {
    ...day1,
    legs: [
      { ...leg, to: 'obihiro', route: a, arriveAt: '2027-02-14T13:00:00.000+09:00' },
      { ...leg, from: 'obihiro', route: b, departAt: '2027-02-14T15:30:00.000+09:00' },
    ],
  }
}

describe('drive-link 受け入れ（場面）', () => {
  it('AC-1: ペルソナの 1 日目から、その日のルート・条件の場面ができ、同じ応答なら同じ場面と同じ鹿の候補', () => {
    const a = scenarioFromDay({ plan, day: day1 }, '')
    const b = scenarioFromDay({ plan, day: day1 }, '')
    expect(a).not.toBeNull()
    expect(b).toEqual(a)
    if (!a) return
    expect(a.source).toBe('trip')
    expect(a.from).toBe(day1.legs[0]?.from)
    expect(a.to).toBe(day1.legs[day1.legs.length - 1]?.to)
    const wa = createWorld(a, ZONES)
    const wb = createWorld(scenarioFromDay({ plan, day: day1 }, '') ?? a, ZONES)
    expect(wb.candidates).toEqual(wa.candidates)
    expect(wa.candidates.length).toBeGreaterThan(0)
    // 出発直後は外で、次の鹿ゾーンまでの km がある
    expect(wa.zone.gps).toMatchObject({ status: 'outside' })
    expect(wa.zone.gps.status === 'outside' && wa.zone.gps.distanceKm).toBeGreaterThan(0)
  })

  it('AC-3: その日の場面を最後まで走ると、区間に入るたびに琥珀になり、完走で DriveResult ができる', () => {
    const scenario = scenarioFromDay({ plan, day: day1 }, '')
    if (!scenario) throw new Error('場面がない')
    const w = createWorld(scenario, ZONES)
    w.candidates = [] // 鹿を出さずに道と区間だけを確かめる
    const entered = new Set<number>()
    setInput(w, { ...NO_INPUT, throttle: true })
    const drive = (untilS: number) => {
      for (let i = 0; i < 20_000 && w.outcome === 'driving' && w.vehicle.s < untilS; i++) {
        advance(w, 100, ZONES)
        if (w.zone.interval !== null) {
          entered.add(w.zone.interval)
          expect(w.alert.state).toBe('zone')
        }
      }
    }
    // ステージごとに、入口の手前 50 m まで飛んで出口まで走る（5 km の手前を全部は走らない。テストを軽くする）。
    // 出口を越えるとステージをクリアして次のステージの始まりへ移り、最後のクリアで completed（drive-tune R1）
    for (const st of w.internal.stages) {
      const first = w.plan.intervals[st.intervals[0] ?? 0]
      w.vehicle = { ...w.vehicle, s: (first?.entryKm ?? 0) * 1000 - 50, speed: 25 }
      const index = w.internal.stageIndex
      for (
        let i = 0;
        i < 40_000 && w.outcome === 'driving' && w.internal.stageIndex === index;
        i++
      ) {
        advance(w, 100, ZONES)
        if (w.zone.interval !== null) {
          entered.add(w.zone.interval)
          expect(w.alert.state).toBe('zone')
        }
      }
      expect(w.alert.state).toBe('safe')
    }
    drive(Infinity)
    expect(w.outcome).toBe('completed')
    expect(entered.size).toBe(w.plan.intervals.length)
    expect(entered.size).toBeGreaterThan(0)
    expect(driveResult(w, null)).toMatchObject({
      tripId: 'K7m2abcd',
      day: 1,
      seed: driveSeed(plan.seed, 1),
      source: 'trip',
      data: day1.data,
      alertEnabled: true,
      startAt: scenario.startAt,
      zonePasses: w.plan.intervals.length,
      outcome: 'completed',
      legIndex: 0,
      collidedDeerId: null,
      inputs: [{ t: 0, input: { ...NO_INPUT, throttle: true } }],
    })
  }, 120_000)
})

describe('場面（R3・R4）', () => {
  it('UC-3a: 2 つの移動はつなぎ目で 1 点にまとまり、20 m 前後の間隔。2 つ目の始まりの道のりと departAt が残る', () => {
    const scenario = scenarioFromDay({ plan, day: twoLegs() }, '')
    if (!scenario) throw new Error('場面がない')
    const gaps = scenario.route
      .slice(1)
      .map((p, i) => metersBetween(scenario.route[i] as LonLat, p))
    expect(Math.max(...gaps)).toBeLessThan(21)
    expect(Math.min(...gaps)).toBeGreaterThan(0.5)
    expect(scenario.legStarts).toHaveLength(1)
    expect(scenario.legStarts[0]?.departAt).toBe('2027-02-14T15:30:00.000+09:00')
    const frame = createRoadFrame(scenario.route)
    const joint = twoLegs().legs[1]?.route[0] as LonLat
    const at = lonLatAt(frame, scenario.legStarts[0]?.sM ?? 0)
    expect(metersBetween(at, joint)).toBeLessThan(25)
  })

  it('UC-3a: 端点が離れていれば直線で埋まり、宿で折り返しても輪にならない', () => {
    const gap = scenarioFromDay({ plan, day: twoLegs(800) }, '')
    if (!gap) throw new Error('場面がない')
    const gaps = gap.route.slice(1).map((p, i) => metersBetween(gap.route[i] as LonLat, p))
    expect(Math.max(...gaps)).toBeLessThan(21)

    const uTurn = scenarioFromDay({ plan, day: twoLegs(0, true) }, '')
    if (!uTurn) throw new Error('場面がない')
    // 折り返しの前後で、道のりの順に並んだ点が行きの線から 30 m 以上離れない（輪やトゲを作らない）
    const frame = createRoadFrame(uTurn.route)
    const turnS = uTurn.legStarts[0]?.sM ?? 0
    for (const ds of [-60, -20, 20, 60]) {
      const p = lonLatAt(frame, turnS + ds)
      const nearest = Math.min(...uTurn.route.map((q) => metersBetween(p, q)))
      expect(nearest).toBeLessThan(30)
    }
    const back = lonLatAt(frame, turnS + 60)
    const fwd = lonLatAt(frame, turnS - 60)
    expect(metersBetween(back, fwd)).toBeLessThan(5)
  })

  it('UC-3b: 出発は最初の移動の departAt、条件は conditions のまま、旅程は plan、日は n、距離は distanceKm の和', () => {
    const scenario = scenarioFromDay({ plan, day: day1 }, '')
    expect(scenario).toMatchObject({
      startAt: day1.legs[0]?.departAt,
      weather: day1.conditions.weather,
      surface: day1.conditions.surface,
      windowFog: day1.conditions.windowFog,
      trip: plan,
      day: 1,
      data: day1.data,
    })
    expect(scenario?.distanceKm).toBeCloseTo(
      day1.legs.reduce((s, l) => s + l.distanceKm, 0),
      6,
    )
  })

  it('UC-3c: アラートは URL だけで決まる（plan.alertEnabled を見ない）', () => {
    const off = { ...plan, alertEnabled: false }
    expect(scenarioFromDay({ plan: off, day: day1 }, '')?.alertEnabled).toBe(true)
    expect(scenarioFromDay({ plan, day: day1 }, '?trip=x&day=1&alert=off')?.alertEnabled).toBe(
      false,
    )
  })

  it('UC-3d: 同じ旅・同じ日なら鹿の候補が同じ、日が違えば違う', () => {
    const d1 = scenarioFromDay({ plan, day: day1 }, '')
    if (!d1) throw new Error('場面がない')
    expect(d1.seed).toBe(driveSeed(plan.seed, 1))
    // 鹿の候補は場面の種だけで決まる（同じルートの区間で、種を日 1・日 2 に変えて比べる）
    const routePlan = planRoute(d1.route, ZONES)
    const day1Candidates = createCandidates(routePlan, d1.seed)
    expect(createCandidates(routePlan, driveSeed(plan.seed, 1))).toEqual(day1Candidates)
    expect(createCandidates(routePlan, driveSeed(plan.seed, 2))).not.toEqual(day1Candidates)
    expect(createCandidates(routePlan, driveSeed(1, 1))).not.toEqual(day1Candidates)
  })

  it('UC-3e: scenarioFromDay は入力を書き換えず、同じ入力に同じ場面を返す', () => {
    const input = { plan, day: structuredClone(day1) }
    const before = JSON.stringify(input)
    const a = scenarioFromDay(input, '')
    expect(JSON.stringify(input)).toBe(before)
    expect(scenarioFromDay(input, '')).toEqual(a)
  })

  it('UC-5d: 遭遇の記録の alertClockAt は進めた時計（startAt + alertAt ではない）', () => {
    const scenario = scenarioFromDay({ plan, day: twoLegs() }, '')
    if (!scenario) throw new Error('場面がない')
    const w = createWorld(scenario, ZONES)
    w.candidates = []
    w.internal.detectRng = () => 0 // 必ず捕捉し、遅延は最短
    const legS = scenario.legStarts[0]?.sM ?? 0
    w.vehicle = { ...w.vehicle, s: legS - 1, speed: 15 }
    advance(w, 100, ZONES) // 2 つ目の移動に入り、時計が 15:30 まで進む
    w.deer = [
      {
        id: 'x',
        candidateId: 'x',
        pattern: 'roadside',
        index: 0,
        s: w.vehicle.s + 80,
        d: 4.5,
        heading: Math.PI / 2,
        pose: 'idle',
        occluded: false,
        startedAt: null,
        gone: false,
      },
    ]
    setInput(w, { ...NO_INPUT, throttle: true })
    for (let i = 0; i < 30 && w.alert.state !== 'danger'; i++) advance(w, 100, ZONES)
    const e = w.encounters.find((x) => x.deerId === 'x')
    expect(e?.alertAt).not.toBeNull()
    const clock = Date.parse(e?.alertClockAt ?? '')
    expect(clock).toBeGreaterThanOrEqual(Date.parse('2027-02-14T15:30:00+09:00'))
    expect(clock).toBeGreaterThan(Date.parse(scenario.startAt) + (e?.alertAt ?? 0) + 60_000)
    expect(e?.alertClockAt).toMatch(/\+09:00$/)
  })

  it('UC-3g: 2 つ目の移動の始まりに着くと、時計がその departAt まで進む。過ぎていれば進めない', () => {
    const scenario = scenarioFromDay({ plan, day: twoLegs() }, '')
    if (!scenario) throw new Error('場面がない')
    const w = createWorld(scenario, ZONES)
    w.candidates = []
    const legS = scenario.legStarts[0]?.sM ?? 0
    // しおりより早く着いた（時計を出発の時刻に戻し、ステージの始まりで進めた分を消す）
    w.internal.clockShiftMs = 0
    w.vehicle = { ...w.vehicle, s: legS - 1, speed: 20 }
    advance(w, 100, ZONES)
    const clock = w.internal.startMs + w.t + w.internal.clockShiftMs
    expect(clock).toBeGreaterThanOrEqual(Date.parse('2027-02-14T15:30:00+09:00'))
    expect(clock).toBeLessThan(Date.parse('2027-02-14T15:30:01+09:00'))

    // 既に過ぎている（出発が 0 時）なら進めない
    const late = { ...scenario, legStarts: [{ sM: legS, departAt: '2027-02-14T00:00+09:00' }] }
    const w2 = createWorld(late, ZONES)
    w2.candidates = []
    w2.vehicle = { ...w2.vehicle, s: legS - 1, speed: 20 }
    const shiftBefore = w2.internal.clockShiftMs
    advance(w2, 100, ZONES)
    expect(w2.internal.clockShiftMs).toBe(shiftBefore)
  })
})

describe('ゾーン（R5）', () => {
  const scenario = scenarioFromDay({ plan, day: day1 }, '')
  if (!scenario) throw new Error('場面がない')
  const routePlan = planRoute(scenario.route, ZONES)

  it('UC-4a: ゾーン状態は道のり s から出し、measureAlongRoute と同じ答え', () => {
    const frame = createRoadFrame(scenario.route)
    for (let s = 0; s < frame.lengthM; s += 997) {
      const fromS = zoneStatusFromS(routePlan, s)
      const m = measureAlongRoute(routePlan, lonLatAt(frame, s), s / 1000)
      expect(fromS.gps.status).toBe(m.current ? 'inside' : 'outside')
      if (m.current && fromS.gps.status === 'inside')
        expect(fromS.gps.remainingKm).toBeCloseTo(m.current.remainingKm, 1)
      if (!m.current && m.next && fromS.gps.status === 'outside')
        expect(fromS.gps.distanceKm).toBeCloseTo(m.next.distanceKm, 1)
    }
  })

  it('UC-4b: ゾーン状態を出すときにルートの頂点を読まない', () => {
    const poisoned = {
      ...routePlan,
      route: new Proxy([] as LonLat[], {
        get() {
          throw new Error('ルートを読んだ')
        },
      }),
      cumulativeM: new Proxy([] as number[], {
        get() {
          throw new Error('道のりの表を読んだ')
        },
      }),
    }
    expect(() => zoneStatusFromS(poisoned, 123_456)).not.toThrow()
  })

  it('UC-4c: sim の区間と API の zones は、数とゾーンの id が一致し、入口の差が 0.5 km 以内', () => {
    expect(routePlan.intervals.map((v) => v.zoneIds)).toEqual(day1.zones.map((z) => z.zoneIds))
    routePlan.intervals.forEach((v, i) => {
      const api = day1.zones[i]
      expect(Math.abs(v.entryKm - (api?.entryKm ?? Infinity))).toBeLessThan(0.5)
    })
  })

  it('UC-4d: 直線の移動の上には区間も鹿の候補も作らない', () => {
    const straight: DayPlan = {
      ...day1,
      legs: day1.legs.map((l) => ({ ...l, source: 'straight' as const })),
    }
    const s = scenarioFromDay({ plan, day: straight }, '')
    if (!s) throw new Error('場面がない')
    const w = createWorld(s, ZONES)
    expect(w.plan.intervals).toEqual([])
    expect(w.candidates).toEqual([])
    // 一部だけかかる区間は外の部分だけ残る
    const cut = withoutRanges(routePlan, [[0, (routePlan.intervals[0]?.entryKm ?? 0) * 1000 + 100]])
    expect(cut.intervals[0]?.entryKm).toBeCloseTo((routePlan.intervals[0]?.entryKm ?? 0) + 0.1, 6)
  })

  it('UC-4f: 直線で埋めたつなぎ目も区間を作らない範囲に入る。範囲の端に接するだけの区間は割らず、長さ 0 の区間を作らない', () => {
    const gap = scenarioFromDay({ plan, day: twoLegs(800) }, '')
    if (!gap) throw new Error('場面がない')
    const joint = gap.legStarts[0]?.sM ?? 0
    // つなぎ目（約 800 m）の範囲が 1 つ、2 つ目の移動の始まりで終わる
    expect(gap.straightRangesM).toHaveLength(1)
    const [from, to] = gap.straightRangesM[0] ?? [0, 0]
    expect(to).toBeCloseTo(joint, 6)
    expect(to - from).toBeGreaterThan(700)
    expect(to - from).toBeLessThan(900)

    const first = routePlan.intervals[0]
    if (!first) throw new Error('区間がない')
    const touching = withoutRanges(routePlan, [[first.exitKm * 1000, first.exitKm * 1000 + 500]])
    expect(touching.intervals[0]).toEqual(first)
    const covering = withoutRanges(routePlan, [[first.entryKm * 1000, first.exitKm * 1000]])
    expect(covering.intervals.every((v) => v.exitKm > v.entryKm)).toBe(true)
    expect(covering.intervals).not.toContainEqual(first)
  })
})

describe('旅の場面の季節（drive-season R2）', () => {
  it('UC-2c: 旅の URL に month・weather があっても、場面の条件はその日の DayPlan のまま', () => {
    const plain = scenarioFromDay({ plan, day: day1 }, '?trip=K7m2abcd&day=1')
    const tampered = scenarioFromDay(
      { plan, day: day1 },
      '?trip=K7m2abcd&day=1&month=7&weather=clear',
    )
    expect(tampered).toEqual(plain)
    expect(tampered?.startAt).toBe(day1.legs[0]?.departAt)
    expect({ surface: tampered?.surface, weather: tampered?.weather }).toEqual({
      surface: day1.conditions.surface,
      weather: day1.conditions.weather,
    })
  })
})
