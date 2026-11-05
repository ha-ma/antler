import type { DayMaterial, LightAt, MaterialZone } from '../models/day-material.js'
import type {
  Arrival,
  ChoiceKind,
  Light,
  RandomSceneKind,
  SceneChoice,
  SceneKind,
  StopDeck,
  StopScene,
  ZoneAhead,
} from '../models/stop-deck.js'
import {
  ACTIVITY_DAY_MIN,
  CHOICE_DELAY_MIN,
  MAX_RANDOM_SCENES,
  MAX_SCENES_PER_DAY,
  MINUTES_PER_WEIGHT,
  RANDOM_INTERVAL_MIN,
  RANDOM_JITTER_MIN,
  RANDOM_SCENE_KINDS,
  SCENE_CHOICES,
  STAY_CHOICES,
  ZONE_MARGIN_KM,
} from '../rules/stop-rules.js'
import { seededRandom } from './seeded-random.js'

// 出来事の束の組み立て（docs/specs/stop-events/functional.md R2〜R6）。同じ入力なら同じ束（純粋関数）。
// 時刻・鹿ゾーン・失うものはここで決め、Claude には書かせない（R1）。値は「しおりどおりに走った場合」の予定。

const MINUTE_MS = 60_000
const JST_MS = 9 * 60 * MINUTE_MS
/** 移動の無い日の楽しみの始まり（しおりの活動の枠 8:00〜） */
const NO_DRIVE_START = 'T08:00:00+09:00'
const DARKNESS: Record<Light, number> = { day: 0, dawn: 1, dusk: 1, night: 2 }

type Stop = DayMaterial['stops'][number]

/** 場面の後に残る行程 */
type Remaining = {
  /** 次に出発する移動の添字（今の移動の途中なら今の移動） */
  fromLeg: number
  zones: MaterialZone[]
  /** 泊まると失う楽しみ（この場面の止まり場所より後の止まり場所のもの） */
  lostStops: Stop[]
  stayAt: string
  /** 今の移動で既に鹿ゾーンを通った（引き返すと同じゾーンをまた通る） */
  passedZone: boolean
}

type Draft = Omit<StopScene, 'choices' | 'arrive'> & {
  atMs: number
  order: number
  remaining: Remaining
}

export function buildStopDeck(m: DayMaterial, lightAt: LightAt): StopDeck {
  const dayBudgetJPY = roundTo((m.budgetPerPersonJPY * m.partySize) / Math.max(1, m.dayCount), 1000)
  const pauses = pausesOf(m)
  const drafts = [...pleasureDrafts(m, pauses, dayBudgetJPY), ...randomDrafts(m, pauses)]
  drafts.sort((a, b) => a.atMs - b.atMs || a.order - b.order)
  const scenes = drafts.map(({ atMs: _atMs, order: _order, remaining, ...scene }) => ({
    ...scene,
    arrive: arrivalAfter(m, remaining, 0),
    choices: choicesFor(scene.kind, remaining, m, dayBudgetJPY, lightAt),
  }))
  return { tripId: m.tripId, day: m.day, date: m.date, dayBudgetJPY, scenes, data: m.data }
}

/** 止まっている場所 k（k 番目の移動の前）の地点。移動が無い日は宿 */
function placeAtPause(m: DayMaterial, k: number): string | undefined {
  if (k === 0) return m.legs[0]?.from ?? m.stay ?? undefined
  return m.legs[k - 1]?.to
}

/** 楽しみごとの止まり場所。しおりの順を保ち、前の楽しみより前には戻らない（R2） */
function pausesOf(m: DayMaterial): number[] {
  const pauses: number[] = []
  let cursor = 0
  for (const stop of m.stops) {
    let k = cursor
    while (k <= m.legs.length && placeAtPause(m, k) !== stop.base) k++
    if (k > m.legs.length) k = cursor
    pauses.push(k)
    cursor = k
  }
  return pauses
}

function pleasureDrafts(m: DayMaterial, pauses: number[], dayBudgetJPY: number): Draft[] {
  const stayMinOf = (s: Stop) => s.weight * MINUTES_PER_WEIGHT
  return m.stops.map((stop, i) => {
    const k = pauses[i] ?? 0
    const group = m.stops.filter((_, j) => pauses[j] === k)
    const before = m.stops.slice(0, i).filter((_, j) => pauses[j] === k)
    const startMs = pauseStartMs(
      m,
      k,
      group.reduce((sum, s) => sum + stayMinOf(s), 0),
    )
    const atMs = startMs + before.reduce((sum, s) => sum + stayMinOf(s), 0) * MINUTE_MS
    const stayMin = stayMinOf(stop)
    return {
      id: `p-${stop.id}`,
      kind: 'pleasure',
      trigger: { kind: 'stop', beforeLeg: k },
      at: jstMinute(atMs),
      atMs,
      order: i,
      pleasure: { id: stop.id, weight: stop.weight, base: stop.base },
      stayMin,
      spentJPY: roundTo((dayBudgetJPY * stayMin) / ACTIVITY_DAY_MIN, 100),
      remaining: {
        fromLeg: k,
        zones: m.zones.filter((z) => z.leg >= k),
        lostStops: m.stops.filter((_, j) => (pauses[j] ?? 0) > k),
        stayAt: stop.base,
        passedZone: false,
      },
    }
  })
}

/** 止まり場所 k に着いた時刻。出発前の楽しみは最初の移動の出発から逆算、移動が無い日は 8:00 */
function pauseStartMs(m: DayMaterial, k: number, groupMin: number): number {
  const prev = m.legs[k - 1]
  if (prev) return prev.arriveMs
  const first = m.legs[0]
  if (first) return first.departMs - groupMin * MINUTE_MS
  return Date.parse(`${m.date}${NO_DRIVE_START}`)
}

function randomDrafts(m: DayMaterial, pauses: number[]): Draft[] {
  const legMin = m.legs.map((l) => (l.arriveMs - l.departMs) / MINUTE_MS)
  const drivingMin = legMin.reduce((a, b) => a + b, 0)
  const count = Math.max(
    0,
    Math.min(
      MAX_RANDOM_SCENES,
      Math.floor(drivingMin / RANDOM_INTERVAL_MIN[m.experience]),
      MAX_SCENES_PER_DAY - m.stops.length,
    ),
  )
  const random = seededRandom(m.seed, m.day)
  const drafts: Draft[] = []
  let previous: RandomSceneKind | null = null
  for (let i = 0; i < count; i++) {
    const jitter = (random() * 2 - 1) * RANDOM_JITTER_MIN
    const target = clamp((drivingMin * (i + 1)) / (count + 1) + jitter, 1, drivingMin - 1)
    const { leg, km } = placeOnLegs(m, legMin, target)
    const options = RANDOM_SCENE_KINDS.filter((k) => k !== previous)
    const kind = options[Math.floor(random() * options.length)] ?? 'fuel'
    previous = kind
    const l = m.legs[leg]
    if (!l) continue
    const atMs = Math.floor(
      l.departMs + (l.distanceKm > 0 ? km / l.distanceKm : 0) * (l.arriveMs - l.departMs),
    )
    drafts.push({
      id: `r${String(i + 1)}-${kind}`,
      kind,
      trigger: { kind: 'road', leg, km },
      at: jstMinute(atMs),
      atMs,
      order: 100 + i,
      pleasure: null,
      stayMin: null,
      spentJPY: null,
      remaining: {
        fromLeg: leg,
        zones: m.zones.filter((z) => z.leg > leg || (z.leg === leg && z.entryKm > km)),
        // この移動の到着地より後（止まり場所 leg + 1 以降）の楽しみ
        lostStops: m.stops.filter((_, j) => (pauses[j] ?? 0) > leg),
        stayAt: l.from,
        passedZone: m.zones.some((z) => z.leg === leg && z.exitKm <= km),
      },
    })
  }
  return drafts
}

/** 運転を始めてから target 分の、移動の添字と道のり（鹿ゾーンの中なら入口の手前に動かす） */
function placeOnLegs(
  m: DayMaterial,
  legMin: number[],
  target: number,
): { leg: number; km: number } {
  let walked = 0
  let leg = 0
  for (; leg < legMin.length - 1; leg++) {
    const span = legMin[leg] ?? 0
    if (walked + span >= target) break
    walked += span
  }
  const span = legMin[leg] ?? 0
  const distanceKm = m.legs[leg]?.distanceKm ?? 0
  let km = span > 0 ? ((target - walked) / span) * distanceKm : 0
  // 動かした先が別のゾーンの中なら、さらにそのゾーンの手前へ（0 km で止まる）
  for (;;) {
    const inside = m.zones.find((z) => z.leg === leg && z.entryKm <= km && km <= z.exitKm)
    if (!inside) break
    const next = Math.max(0, inside.entryKm - ZONE_MARGIN_KM)
    if (next === km) break
    km = next
  }
  return { leg, km: round(km, 2) }
}

/** 遅れを足した、その日の最後の到着。移動が残っていなければ null */
function arrivalAfter(m: DayMaterial, remaining: Remaining, delayMin: number): Arrival | null {
  const last = m.legs[m.legs.length - 1]
  if (!last || remaining.fromLeg >= m.legs.length) return null
  return { place: last.to, at: jstMinute(last.arriveMs + delayMin * MINUTE_MS) }
}

/** 残りのゾーンのうち、遅れをずらした時刻で一番暗いもの（同じ暗さなら早いもの。R4） */
function darkestZone(zones: MaterialZone[], delayMin: number, lightAt: LightAt): ZoneAhead | null {
  let best: ZoneAhead | null = null
  let bestDark = -1
  let bestMs = Number.POSITIVE_INFINITY
  for (const zone of zones) {
    const entryMs = zone.entryMs + delayMin * MINUTE_MS
    const light = lightAt(entryMs, zone.entry)
    const dark = DARKNESS[light]
    if (dark > bestDark || (dark === bestDark && entryMs < bestMs)) {
      bestDark = dark
      bestMs = entryMs
      best = {
        entryAt: jstMinute(entryMs),
        light,
        km: round(zone.exitKm - zone.entryKm, 1),
        roadName: zone.roadName,
        count: zones.length,
      }
    }
  }
  return best
}

function choicesFor(
  kind: SceneKind,
  remaining: Remaining,
  m: DayMaterial,
  dayBudgetJPY: number,
  lightAt: LightAt,
): SceneChoice[] {
  const lastDay = m.day >= m.dayCount || m.stay === null
  const kinds: readonly ChoiceKind[] = SCENE_CHOICES[kind]
  const offered = kinds.filter((c) => {
    if (!STAY_CHOICES.includes(c)) return true
    if (lastDay || remaining.zones.length === 0) return false
    return !(c === 'turn-back' && remaining.passedZone)
  })
  return offered.map((c) => {
    if (STAY_CHOICES.includes(c)) {
      return {
        id: c,
        kind: c,
        delayMin: 0,
        endsDay: true,
        stayAt: remaining.stayAt,
        arrive: null,
        zone: null,
        lost: {
          jpy: m.stay !== null && m.stay !== remaining.stayAt ? dayBudgetJPY : 0,
          weight: remaining.lostStops.reduce((sum, s) => sum + s.weight, 0),
          pleasures: remaining.lostStops.map((s) => s.id),
          lateReturn: false,
        },
      }
    }
    const delayMin = CHOICE_DELAY_MIN[c]
    const arrive = arrivalAfter(m, remaining, delayMin)
    const lateReturn =
      m.returnDeadlineMs !== null && arrive !== null && Date.parse(arrive.at) > m.returnDeadlineMs
    return {
      id: c,
      kind: c,
      delayMin,
      endsDay: false,
      stayAt: null,
      arrive,
      zone: darkestZone(remaining.zones, delayMin, lightAt),
      lost: { jpy: 0, weight: 0, pleasures: [], lateReturn },
    }
  })
}

/** 分に切り捨てた +09:00 の ISO（DayPlan の時刻と同じ形） */
export function jstMinute(ms: number): string {
  const floored = Math.floor(ms / MINUTE_MS) * MINUTE_MS
  return `${new Date(floored + JST_MS).toISOString().slice(0, 16)}+09:00`
}

/** 四捨五入で unit 単位に丸める（R5・R6） */
function roundTo(value: number, unit: number): number {
  return Math.round(value / unit) * unit
}

function round(value: number, digits: number): number {
  const f = 10 ** digits
  return Math.round(value * f) / f
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}
