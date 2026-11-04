import { z } from 'zod'

// POST /api/trips/:id/day/:n/stop-deck のパス（docs/specs/stop-events/functional.md「API エンドポイント」）。
// id の形は UseCase が確かめる（形が違っても 404）。n は 1〜999 の整数の表記だけ。body は読まない。

export const stopDeckParamsSchema = z.strictObject({
  id: z.string(),
  n: z
    .string()
    .regex(/^[1-9][0-9]{0,2}$/)
    .transform(Number),
})

/** 所有者トークンのヘッダ（形は UseCase が確かめ、無い・違うを同じ 403 にする） */
export const OWNER_TOKEN_HEADER = 'x-owner-token'
