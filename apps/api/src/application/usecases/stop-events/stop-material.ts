import type { TripPlan } from '@antler/schema'
import { placeById, pleasureById, pointAtKm, type DayPlan, type Localized } from '@antler/trip'
import type { DayMaterial } from '../../../domain/stop-events/models/day-material.js'
import type { StopDeck } from '../../../domain/stop-events/models/stop-deck.js'
import type { StopWritingBrief } from '../../../domain/stop-events/models/stop-writing.js'

// 保存した旅と DayPlan（@antler/trip）から、domain の束の入力と Claude の材料を作る（docs/specs/stop-events/functional.md R2・R7）。
// domain は @antler/* を import しないので、値をここで写す。

/** 返却の何分前に返却地へ着くか（plan-trip のしおりの組み立てと同じ 1 時間） */
const RETURN_MARGIN_MS = 60 * 60_000

export function toDayMaterial(plan: TripPlan, dayPlan: DayPlan): DayMaterial {
  const today = plan.days[dayPlan.day - 1]
  const weights = new Map(plan.pleasures.map((p) => [p.id, p.weight]))
  return {
    tripId: plan.id,
    seed: plan.seed,
    day: dayPlan.day,
    dayCount: plan.days.length,
    date: dayPlan.date,
    partySize: plan.party.size,
    experience: plan.party.experience,
    budgetPerPersonJPY: plan.budgetPerPersonJPY,
    legs: dayPlan.legs.map((leg) => ({
      from: leg.from,
      to: leg.to,
      departMs: Date.parse(leg.departAt),
      arriveMs: Date.parse(leg.arriveAt),
      distanceKm: leg.distanceKm,
    })),
    zones: dayPlan.zones.map((zone) => {
      const route = dayPlan.legs[zone.leg]?.route ?? []
      const [lon, lat] = pointAtKm(route, zone.entryKm)
      return {
        leg: zone.leg,
        entryKm: zone.entryKm,
        exitKm: zone.exitKm,
        entryMs: Date.parse(zone.entryAt),
        entry: { lat, lon },
        roadName: zone.roadName,
      }
    }),
    stops: dayPlan.stops.map((s) => ({ id: s.id, base: s.base, weight: weights.get(s.id) ?? 1 })),
    stay: today?.stay ?? null,
    // 最終日だけ、返却の 1 時間前（しおりの返却の余裕。plan-trip R3）
    returnDeadlineMs:
      dayPlan.day === plan.days.length ? Date.parse(plan.return.at) - RETURN_MARGIN_MS : null,
    data: { routes: dayPlan.data.routes, zones: dayPlan.data.zones },
  }
}

function placeName(id: string | null | undefined): Localized | null {
  if (!id) return null
  return placeById(id)?.name ?? null
}

/** Claude に渡す材料。名前はマスター、数字は遅れ・重さだけ（時刻・金額は渡さない。R7・UC-2d） */
export function toWritingBrief(plan: TripPlan, dayPlan: DayPlan, deck: StopDeck): StopWritingBrief {
  const firstLeg = dayPlan.legs[0]
  const lastLeg = dayPlan.legs[dayPlan.legs.length - 1]
  return {
    lang: plan.lang,
    area: plan.area,
    month: Number(dayPlan.date.slice(5, 7)),
    party: { size: plan.party.size, experience: plan.party.experience },
    conditions: { weather: dayPlan.conditions.weather, surface: dayPlan.conditions.surface },
    from: placeName(firstLeg?.from ?? dayPlan.stayAt),
    to: placeName(lastLeg?.to ?? dayPlan.stayAt),
    scenes: deck.scenes.map((scene) => {
      const pleasure = scene.pleasure ? pleasureById(scene.pleasure.id) : undefined
      const placeId =
        scene.trigger.kind === 'stop'
          ? (scene.pleasure?.base ?? null)
          : (dayPlan.legs[scene.trigger.leg]?.from ?? null)
      return {
        id: scene.id,
        kind: scene.kind,
        pleasure:
          pleasure && scene.pleasure
            ? { name: pleasure.name, weight: scene.pleasure.weight, timeOfDay: pleasure.timeOfDay }
            : null,
        place: placeName(placeId),
        choices: scene.choices.map((c) => ({
          id: c.id,
          kind: c.kind,
          delayMin: c.delayMin,
          endsDay: c.endsDay,
          zoneLight: c.zone?.light ?? null,
          lostWeight: c.lost.weight,
          lostPleasures: c.lost.pleasures.flatMap((id) => {
            const p = pleasureById(id)
            return p ? [p.name] : []
          }),
        })),
      }
    }),
  }
}
