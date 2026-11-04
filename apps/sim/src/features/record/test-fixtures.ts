import type { Lang } from '@antler/schema'
import {
  assessRisk,
  buildItinerary,
  buildTripPlan,
  PERSONA_INPUT,
  recordTripOf,
  summarizeRecord,
  type DriveRunInput,
} from '@antler/trip'
import type { RecordData } from './types'

// record のテストの見本（ペルソナの旅と走行の記録）。本番のコードからは使わない。

export const TRIP_ID = 'K7m2abcd'
export const OWNER_TOKEN = 'ab'.repeat(32)

let n = 0
export function run(patch: Partial<DriveRunInput> = {}): DriveRunInput {
  n += 1
  return {
    runId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    day: 1,
    alertEnabled: true,
    outcome: 'completed',
    zonePasses: 2,
    encounters: [],
    frames: null,
    ...patch,
  }
}

export function personaRecord(runs: DriveRunInput[] = [], lang: Lang = 'ja'): RecordData {
  const itinerary = buildItinerary(PERSONA_INPUT)
  const plan = buildTripPlan(
    { ...PERSONA_INPUT, lang },
    itinerary,
    assessRisk(PERSONA_INPUT, itinerary),
    {
      id: TRIP_ID,
      seed: 918273,
      title: '流氷とタンチョウと、雪見の温泉。',
    },
  )
  return { trip: recordTripOf(plan), record: summarizeRecord(plan, runs) }
}
