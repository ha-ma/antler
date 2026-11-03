import { z } from 'zod'
import { AlertFlagSchema } from './alert-flag'
import { CaptureSchema } from './capture'
import { ClientMessageSchema } from './client-message'
import { TripPlanSchema } from './trip-plan'

// Zod の定義から JSON Schema（draft 2020-12）を作る。edge（Python）はこの JSON Schema で検証する。
// 書き出しは `npm run build:json -w @antler/schema`。UC-1i のテストが、書き出し済みのファイルと一致するかを確かめる。

export const JSON_SCHEMA_SOURCES = {
  'alert-flag': AlertFlagSchema,
  capture: CaptureSchema,
  'client-message': ClientMessageSchema,
  'trip-plan': TripPlanSchema,
} as const

export type JsonSchemaName = keyof typeof JSON_SCHEMA_SOURCES

export function buildJsonSchema(name: JsonSchemaName): Record<string, unknown> {
  const schema = z.toJSONSchema(JSON_SCHEMA_SOURCES[name], {
    target: 'draft-2020-12',
    // TripPlan の refine（drivers ≤ size など）は JSON Schema に出ない。TS 側でだけ確かめる
    unrepresentable: 'any',
  })
  return { $id: `https://antler.local/schema/${name}.schema.json`, ...schema }
}

/** ファイルに書く文字列（末尾の改行つき）。書き出しとテストの両方がこれを使う。 */
export function renderJsonSchema(name: JsonSchemaName): string {
  return `${JSON.stringify(buildJsonSchema(name), null, 2)}\n`
}
