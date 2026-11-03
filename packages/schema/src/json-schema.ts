import { z } from 'zod'
import { AlertFlagSchema } from './alert-flag'
import { CaptureSchema } from './capture'
import { ClientMessageSchema } from './client-message'
import { JudgeRequestSchema } from './judge-request'
import { TripPlanSchema } from './trip-plan'

// Zod の定義から JSON Schema（draft 2020-12）を作る。edge（Python）はこの JSON Schema で検証する。
// 書き出しは `npm run build:json -w @antler/schema`。UC-1i のテストが、書き出し済みのファイルと一致するかを確かめる。

export const JSON_SCHEMA_SOURCES = {
  'alert-flag': AlertFlagSchema,
  capture: CaptureSchema,
  'client-message': ClientMessageSchema,
  'judge-request': JudgeRequestSchema,
  'trip-plan': TripPlanSchema,
} as const

export type JsonSchemaName = keyof typeof JSON_SCHEMA_SOURCES

/**
 * 正規表現を JS と Python（edge の jsonschema は re.search を使う）で同じ意味にする。
 * - `\d` は Python では全角などの Unicode 数字にも当たるので `[0-9]` にする
 * - 末尾の `$` は Python では末尾の改行の前にも当たるので `(?!\n)$` にする
 */
export function portablePattern(pattern: string): string {
  return pattern.replace(/\\d/g, '[0-9]').replace(/(?<!\\)\$$/, '(?!\\n)$')
}

function portable(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(portable)
  if (node && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node).map(([k, v]) => [
        k,
        k === 'pattern' && typeof v === 'string' ? portablePattern(v) : portable(v),
      ]),
    )
  }
  return node
}

export function buildJsonSchema(name: JsonSchemaName): Record<string, unknown> {
  // 表せないもの（transform・Date など）が入ったら黙って「何でも通す」にせず、ここで落とす。
  // TripPlan の refine（drivers ≤ size など）は JSON Schema に出ないだけで、TS 側で確かめる
  const schema = z.toJSONSchema(JSON_SCHEMA_SOURCES[name], { target: 'draft-2020-12' })
  return { $id: `https://antler.local/schema/${name}.schema.json`, ...(portable(schema) as object) }
}

/** ファイルに書く文字列（末尾の改行つき）。書き出しとテストの両方がこれを使う。 */
export function renderJsonSchema(name: JsonSchemaName): string {
  return `${JSON.stringify(buildJsonSchema(name), null, 2)}\n`
}
