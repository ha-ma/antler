import { CaptureConflictError, CaptureInputError } from '../errors/capture-errors.js'
import type { CaptureImageFormat } from '../models/capture-image.js'
import { CAPTURE_IMAGE_HASH_PREFIX, CAPTURE_KEY_PATTERN } from '../rules/capture-rules.js'

// Capture の同一性（docs/specs/edge-capture/functional.md A4・A6、resilience.md「Concurrency / Idempotency」）。
// - key = id の小文字（大文字小文字を区別しないファイルシステムで cap_A と cap_a が別物にならない）
// - 本文のハッシュの材料 = キーを辞書順に並べた Capture の JSON + "\n" + 画像の sha256
// - 論理の画像パスは captures/{id}.{jpg|png}（サーバーが決める。クライアントが送った値は使わない）
// ハッシュの計算そのものは技術ポート（Hasher）が行う。ここは材料を作る純粋関数だけ。

/** ファイル名に使う key。パスに使う前に必ず通す（外れたら入力エラー） */
export function captureKey(id: string): string {
  const key = id.toLowerCase()
  if (!CAPTURE_KEY_PATTERN.test(key)) throw new CaptureInputError(['id: 形が正しくありません'])
  return key
}

export function imageExtension(format: CaptureImageFormat): 'jpg' | 'png' {
  return format === 'jpeg' ? 'jpg' : 'png'
}

/** Capture.image と応答に入れる論理のパス */
export function logicalImagePath(id: string, format: CaptureImageFormat): string {
  return `captures/${id}.${imageExtension(format)}`
}

/** 実ファイル名。同じ id で中身が違う競合の画像を取り違えないよう、画像の sha256 の先頭を入れる */
export function imageFileName(
  key: string,
  imageSha256: string,
  format: CaptureImageFormat,
): string {
  return `${key}-${imageSha256.slice(0, CAPTURE_IMAGE_HASH_PREFIX)}.${imageExtension(format)}`
}

/** キーを辞書順に並べた JSON（入れ子も同様）。配列の順は保つ */
export function canonicalCaptureJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    )
    const sorted: Record<string, unknown> = {}
    for (const [k, v] of entries) sorted[k] = sortKeys(v)
    return sorted
  }
  return value
}

/** 本文のハッシュの材料。capture は「サーバーが決めた形」（image を置き換え、consent: true）を渡す */
export function captureBodyMaterial(capture: unknown, imageSha256: string): string {
  return `${canonicalCaptureJson(capture)}\n${imageSha256}`
}

/**
 * 既にある同じ key への再送の扱い。本文のハッシュが同じなら replay（200）。
 * 違う・既存が読めない（勝った側がまだ書いていない等）なら CaptureConflictError（409。既存は上書きしない）。
 */
export function decideOnExistingCapture(
  existingBodyHash: string | null,
  bodyHash: string,
): 'replay' {
  if (existingBodyHash === null || existingBodyHash !== bodyHash) throw new CaptureConflictError()
  return 'replay'
}
