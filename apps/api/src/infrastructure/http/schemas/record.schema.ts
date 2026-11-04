import { DriveRunInputSchema } from '@antler/trip'
import { z } from 'zod'

// 旅の記録の HTTP 契約（docs/specs/record/functional.md「API エンドポイント」、threat.md）。
// id の形は UseCase が確かめる（形が違っても 404。旅が無いのと区別しない）。

export const recordParamsSchema = z.strictObject({ id: z.string() })

/** POST /api/trips/:id/runs の body（strict。知らない欄は 400。MASS-1） */
export const saveRunBodySchema = DriveRunInputSchema

/** `Authorization: Bearer <token>` の中身。無い・形が違えば空文字（UseCase が 401 にする） */
export function bearerToken(header: string | undefined): string {
  const match = /^Bearer ([^\s]+)$/.exec(header ?? '')
  return match?.[1] ?? ''
}
