import { z } from 'zod'

// POST /api/trips/:id/losses の HTTP 契約（docs/specs/loss/functional.md「API エンドポイント」・R7、threat.md「Mass Assignment」）。
// body は strict（story・tripId・createdAt などの知らない欄は 400）。範囲（日・移動・暦日・その日の楽しみ）は
// 保存したしおりと突き合わせる必要があるので、ドメインの checkCollision が確かめる。

export const lossParamsSchema = z.strictObject({ id: z.string() })

const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

export const createLossBodySchema = z.strictObject({
  day: z.number().int().min(1).max(999),
  leg: z.number().int().min(0).max(99),
  // タイムゾーン付きの ISO 8601（暦日は JST に直して確かめる）
  at: z.iso.datetime({ offset: true }),
  alertEnabled: z.boolean(),
  achievedStops: z.array(Slug).max(10),
})
