import { TripPlanSchema } from '@antler/schema'
import { describe, expect, it } from 'vitest'
import { assessRisk } from '../risk'
import { buildItinerary } from '../itinerary'
import { PERSONA_INPUT } from '../input'
import { buildTripPlan } from '../plan'
import { RecordTripSchema, recordTripOf } from './trip-view'

// docs/specs/record/functional.md R4・UC-4a（記録に見せる欄だけ）

describe('recordTripOf', () => {
  it('UC-4a: 画面に出す欄だけを返し、予算・seed・リスクを含めない', () => {
    const itinerary = buildItinerary(PERSONA_INPUT)
    const plan = TripPlanSchema.parse(
      buildTripPlan(PERSONA_INPUT, itinerary, assessRisk(PERSONA_INPUT, itinerary), {
        id: 'K7m2abcd',
        seed: 918273,
        title: '流氷とタンチョウ',
      }),
    )
    const trip = recordTripOf(plan)
    expect(RecordTripSchema.safeParse(trip).success).toBe(true)
    expect(trip).toMatchObject({
      id: 'K7m2abcd',
      lang: plan.lang,
      title: '流氷とタンチョウ',
      partySize: plan.party.size,
    })
    expect(trip.days).toHaveLength(plan.days.length)
    const json = JSON.stringify(trip)
    expect(json).not.toContain('budgetPerPersonJPY')
    expect(json).not.toContain('seed')
    expect(json).not.toContain('riskScore')
    expect(RecordTripSchema.safeParse({ ...trip, seed: 1 }).success).toBe(false)
  })
})
