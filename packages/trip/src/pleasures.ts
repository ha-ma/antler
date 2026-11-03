import { Lang } from '@antler/schema'
import { z } from 'zod'
import pleasuresJson from '../data/pleasures.json'
import type { Area, Pleasure } from './types'

// 楽しみのマスター（A1-2 のカード）。data/pleasures.json を読み込み時に検証する。形が違えば例外。
// verified は事実（季節・所要・拠点）をユーザーが確かめたか。暫定は false。

const LocalizedSchema = z.strictObject(
  Object.fromEntries(Lang.options.map((l) => [l, z.string().min(1)])) as Record<
    z.infer<typeof Lang>,
    z.ZodString
  >,
)

const PleasureSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  area: z.enum(['doto', 'doo']),
  name: LocalizedSchema,
  note: LocalizedSchema,
  base: z.string().min(1),
  timeOfDay: z.enum(['day', 'night', 'dawn']),
  months: z.array(z.number().int().min(1).max(12)),
  verified: z.boolean(),
})

export const PLEASURES: readonly Pleasure[] = z.array(PleasureSchema).parse(pleasuresJson)

const BY_ID = new Map(PLEASURES.map((p) => [p.id, p]))

export function pleasureById(id: string): Pleasure | undefined {
  return BY_ID.get(id)
}

export function pleasuresInArea(area: Area): readonly Pleasure[] {
  return PLEASURES.filter((p) => p.area === area)
}
