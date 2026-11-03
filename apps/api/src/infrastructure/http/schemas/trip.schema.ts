import { TripInputSchema } from '@antler/trip'
import { z } from 'zod'

// POST /api/trips の HTTP 契約（docs/specs/plan-trip/functional.md「API エンドポイント」、threat.md「Mass Assignment」）。
// body は @antler/trip の TripInputSchema（strict。知らない欄・マスターに無い楽しみ・範囲外は拒否）。
// 画面の入力検証と同じものを使い、規則を二重に書かない。

export const createTripBodySchema = TripInputSchema

export const createTripHeadersSchema = z.object({
  'idempotency-key': z.uuid(),
})
