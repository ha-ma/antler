import { z } from 'zod'
import { DEER_PATTERNS } from '../../../domain/stop-events/models/trip-event.js'
import { MAX_EVENTS_PER_POST } from '../../../domain/stop-events/rules/stop-rules.js'

// POST /api/trips/:id/events（docs/specs/stop-events/functional.md R10、threat.md「Mass Assignment」）。
// strict: 知らない欄（緯度経度・計算値・tripId など）は 400。kind の判別共用体。

export const tripEventParamsSchema = z.strictObject({ id: z.string() })

const SLUG_ID = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
const UUID_V4 = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
const Pattern = z.enum(DEER_PATTERNS)

const base = {
  seq: z.number().int().min(0).max(99_999),
  day: z.number().int().min(1).max(31),
  at: z.iso.datetime({ offset: true, local: false }),
  leg: z.number().int().min(0).max(99).optional(),
  km: z.number().min(0).max(2000).optional(),
}

const TripEventSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...base, kind: z.literal('choice'), sceneId: SLUG_ID, choiceId: SLUG_ID }),
  z.strictObject({
    ...base,
    kind: z.literal('encounter'),
    pattern: Pattern,
    alerted: z.boolean(),
    alertDistanceM: z.number().min(0).max(500).nullable(),
    userSpotted: z.boolean(),
  }),
  z.strictObject({
    ...base,
    kind: z.literal('collision'),
    pattern: Pattern,
    speedKmh: z.number().min(0).max(200),
  }),
  z.strictObject({
    ...base,
    kind: z.literal('avoidance'),
    pattern: Pattern,
    closestM: z.number().min(0).max(500),
    alertToBrakeMs: z.number().int().min(0).max(60_000).nullable(),
  }),
])

export const recordTripEventsBodySchema = z.strictObject({
  runId: UUID_V4,
  alertEnabled: z.boolean(),
  events: z.array(TripEventSchema).min(1).max(MAX_EVENTS_PER_POST),
})
