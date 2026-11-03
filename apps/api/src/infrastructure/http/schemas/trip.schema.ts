import { TripInputSchema } from '@antler/trip'
import { z } from 'zod'

// POST /api/trips の HTTP 契約（docs/specs/plan-trip/functional.md「API エンドポイント」、threat.md「Mass Assignment」）。
// body は @antler/trip の TripInputSchema（strict。知らない欄・マスターに無い楽しみ・範囲外は拒否）。
// 画面の入力検証と同じものを使い、規則を二重に書かない。

export const createTripBodySchema = TripInputSchema

// 冪等キーは端末が crypto.randomUUID() で作る UUID v4 だけ（推測できない 122 ビットの乱数。v1 などの時刻由来は拒否）
export const createTripHeadersSchema = z.object({
  'idempotency-key': z.uuidv4(),
})
