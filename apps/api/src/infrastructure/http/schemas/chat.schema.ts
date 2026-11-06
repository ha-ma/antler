import { z } from 'zod'

// POST /api/trips/:id/day/:n/chat の HTTP 契約（docs/specs/drive-audio-chat/functional.md「API エンドポイント」、threat.md）。
// id の形は UseCase が確かめる（形が違っても 404）。n は 1〜999 の整数の表記だけ。body は読まない。
// 応答の形は sim が zod で確かめる（欄を増やさない）。テストはこの schema で応答を確かめる。

export const chatParamsSchema = z.strictObject({
  id: z.string(),
  n: z
    .string()
    .regex(/^[1-9][0-9]{0,2}$/)
    .transform(Number),
})

const LocalizedTextSchema = z.strictObject({
  ja: z.string().min(1),
  en: z.string().min(1),
  zh: z.string().min(1),
  ko: z.string().min(1),
})

export const chatLineSchema = z.strictObject({
  id: z.string().regex(/^l\d{2}$/),
  cue: z.strictObject({
    kind: z.literal('road'),
    leg: z.number().int().min(0),
    km: z.number().min(0),
  }),
  topic: z.enum(['depart', 'pleasure', 'weather', 'light', 'scenery', 'snack', 'music']),
  speaker: z.enum(['p1', 'p2', 'p3', 'radio']),
  text: LocalizedTextSchema,
})

export const chatResponseSchema = z.strictObject({
  chat: z.strictObject({
    tripId: z.string(),
    day: z.number().int().min(1),
    lines: z.array(chatLineSchema),
    data: z.strictObject({ routes: z.string().min(1), zones: z.string().min(1) }),
  }),
})
