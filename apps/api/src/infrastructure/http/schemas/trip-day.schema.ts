import { z } from 'zod'

// GET /api/trips/:id/day/:n のパス（docs/specs/brief-map/functional.md R5、threat.md）。
// id の形は UseCase が確かめる（形が違っても 404。旅が無いのと区別しない）。n は 1〜999 の整数の表記だけを通す。

export const tripDayParamsSchema = z.strictObject({
  id: z.string(),
  n: z
    .string()
    .regex(/^[1-9][0-9]{0,2}$/)
    .transform(Number),
})
