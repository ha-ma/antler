import { CaptureSchema, type Capture } from '@antler/schema'
import { z } from 'zod'
import { CaptureInputError } from '../../../domain/captures/errors/capture-errors.js'
import {
  CAPTURE_ID_MAX_LENGTH,
  CAPTURE_JSON_MAX_BYTES,
} from '../../../domain/captures/rules/capture-rules.js'

// POST /api/captures の HTTP 契約（docs/specs/edge-capture/functional.md A1・A9、threat.md「Mass Assignment」）。
// multipart の欄名は固定（sim からも同じ）: capture = Capture の JSON 文字列（8 KB まで）、image = 画像のファイル。
// capture は CaptureSchema（strict。知らない欄は拒否）に通す。id は HTTP の層で 40 文字まで（凍結の CaptureSchema は変えない）。
// 検証に外れたら CaptureInputError（400 INVALID_INPUT）。メッセージには欄名と規則だけを入れ、送られた値は入れない。

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).byteLength

/** multipart の読み方。capture は文字列、image はファイル。同じ名前の欄が 2 つ以上あれば配列になり外れる。ほかの欄は無視する */
const captureFormSchema = z.object({
  capture: z
    .string()
    .refine((text) => utf8Bytes(text) <= CAPTURE_JSON_MAX_BYTES, 'capture は 8 KB まで'),
  image: z.instanceof(File, { message: 'image はファイルで送る' }),
})

/**
 * Capture 本体。凍結の CaptureSchema に、id の長さの上限と、image が相対パスであることを足す。
 * image の値は保存には使わない（サーバーが captures/{id}.{ext} を決める）。絶対パスは形の時点で外す（AUTH-3）
 */
const captureBodySchema = CaptureSchema.refine((c) => c.id.length <= CAPTURE_ID_MAX_LENGTH, {
  path: ['id'],
  message: `id は ${String(CAPTURE_ID_MAX_LENGTH)} 文字まで`,
}).refine((c) => !c.image.startsWith('/'), {
  path: ['image'],
  message: 'image は相対パスで書く',
})

function describeIssues(issues: readonly z.core.$ZodIssue[]): string[] {
  return issues.map((issue) => {
    const where = issue.path.map(String).join('.')
    const detail =
      issue.code === 'unrecognized_keys' ? `知らない欄: ${issue.keys.join(', ')}` : issue.message
    return where === '' ? detail : `${where}: ${detail}`
  })
}

/** multipart の本文（parseBody の結果）から capture の文字列と image のファイルを取り出す */
export function parseCaptureForm(body: Record<string, unknown>): {
  captureText: string
  image: File
} {
  const parsed = captureFormSchema.safeParse(body)
  if (!parsed.success) throw new CaptureInputError(describeIssues(parsed.error.issues))
  return { captureText: parsed.data.capture, image: parsed.data.image }
}

/** capture 欄の JSON 文字列を Capture にする */
export function parseCaptureJson(text: string): Capture {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new CaptureInputError(['capture: JSON として読めません'])
  }
  const parsed = captureBodySchema.safeParse(raw)
  if (!parsed.success) throw new CaptureInputError(describeIssues(parsed.error.issues))
  return parsed.data
}
