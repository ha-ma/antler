import type {
  CaptureImageFormat,
  CaptureImageInspection,
  CaptureImageRejection,
} from '../models/capture-image.js'
import {
  CAPTURE_IMAGE_MAX_BYTES,
  CAPTURE_IMAGE_MAX_PX,
  CAPTURE_IMAGE_MIN_PX,
} from './capture-rules.js'

// 受け取る画像の検査（docs/specs/edge-capture/functional.md A3、threat.md「画像」）。純粋な関数で、例外は投げない。
// - 先頭のバイトで JPEG / PNG を見分ける（ファイル名・Content-Type は信用しない）
// - 寸法（JPEG は SOF、PNG は IHDR）を Capture の imageSize と照合し、16〜2048 px だけ通す
// - メタデータを持つ画像は受けない。JPEG は APP0 が JFIF\0 の 1 つだけ（サムネイル 0×0）で APP1〜15・COM が無い。
//   PNG は IHDR PLTE IDAT IEND tRNS gAMA cHRM sRGB sBIT bKGD pHYs 以外のチャンクが無い
// - EOI / IEND の後ろに 1 バイトも付けない。途中で切れた・SOF や IHDR が無い・チャンク長が本文を超える画像は拒否

type Failure = { ok: false; reason: CaptureImageRejection }
type Parsed = { ok: true; width: number; height: number } | Failure

const fail = (reason: CaptureImageRejection): Failure => ({ ok: false, reason })

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const PNG_ALLOWED_CHUNKS: ReadonlySet<string> = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'sBIT',
  'bKGD',
  'pHYs',
])
/** JFIF の APP0 の長さ（長さ欄 2 ＋ "JFIF\0" 5 ＋ 版 2 ＋ 単位 1 ＋ 密度 4 ＋ サムネイル寸法 2 = 16）。サムネイルの画素が無い */
const JFIF_SEGMENT_LENGTH = 16
const JFIF_ID = [0x4a, 0x46, 0x49, 0x46, 0x00]

function isSofMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
}

function parseJpeg(b: Uint8Array): Parsed {
  const n = b.length
  const at = (i: number): number => b[i] ?? -1
  let pos = 2
  let width = 0
  let height = 0
  let sawSof = false
  let sawSos = false
  let sawApp0 = false

  for (;;) {
    if (at(pos) !== 0xff) return fail('malformed')
    // マーカーの前の詰め物（FF が続く）は読み飛ばす
    while (at(pos + 1) === 0xff) pos += 1
    const marker = at(pos + 1)
    if (marker < 0) return fail('malformed')

    if (marker === 0xd9) {
      // EOI。ここが本文の終わりでなければ余りがある
      if (pos + 2 !== n) return fail('trailing_data')
      if (!sawSof || !sawSos) return fail('malformed')
      return { ok: true, width, height }
    }
    // SOI の再出現・RST・TEM・0x00 は、走査データの外では現れない
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      return fail('malformed')
    }

    if (pos + 4 > n) return fail('malformed')
    const length = (at(pos + 2) << 8) | at(pos + 3)
    const segmentEnd = pos + 2 + length
    if (length < 2 || segmentEnd > n) return fail('malformed')
    const dataStart = pos + 4

    if (marker === 0xe0) {
      if (sawApp0) return fail('metadata')
      sawApp0 = true
      const isJfif = JFIF_ID.every((v, i) => at(dataStart + i) === v)
      // サムネイルは 0×0 のみ。JFXX・別の APP0・サムネイル付きは拒否
      if (
        !isJfif ||
        length !== JFIF_SEGMENT_LENGTH ||
        at(dataStart + 12) !== 0 ||
        at(dataStart + 13) !== 0
      ) {
        return fail('metadata')
      }
    } else if ((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe) {
      return fail('metadata')
    } else if (isSofMarker(marker)) {
      if (sawSof || length < 8) return fail('malformed')
      sawSof = true
      height = (at(dataStart + 1) << 8) | at(dataStart + 2)
      width = (at(dataStart + 3) << 8) | at(dataStart + 4)
      if (width === 0 || height === 0) return fail('malformed')
    }

    pos = segmentEnd
    if (marker === 0xda) {
      sawSos = true
      // 走査データは次のマーカー（FF のあとが 00・RST・FF 以外）まで続く
      for (;;) {
        if (pos >= n) return fail('malformed')
        if (at(pos) !== 0xff) {
          pos += 1
          continue
        }
        const next = at(pos + 1)
        if (next < 0) return fail('malformed')
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          pos += 2
        } else if (next === 0xff) {
          pos += 1
        } else {
          break
        }
      }
    }
  }
}

function parsePng(b: Uint8Array): Parsed {
  const n = b.length
  const at = (i: number): number => b[i] ?? 0
  const u32 = (i: number): number =>
    at(i) * 0x1000000 + (at(i + 1) << 16) + (at(i + 2) << 8) + at(i + 3)
  let pos = PNG_SIGNATURE.length
  let first = true
  let width = 0
  let height = 0
  let sawIdat = false

  for (;;) {
    if (pos + 8 > n) return fail('malformed')
    const length = u32(pos)
    const type = String.fromCharCode(at(pos + 4), at(pos + 5), at(pos + 6), at(pos + 7))
    const end = pos + 12 + length
    if (length > 0x7fffffff || end > n) return fail('malformed')

    if (first) {
      if (type !== 'IHDR' || length !== 13) return fail('malformed')
      width = u32(pos + 8)
      height = u32(pos + 12)
      first = false
    } else if (type === 'IHDR') {
      return fail('malformed')
    }
    if (!PNG_ALLOWED_CHUNKS.has(type)) return fail('metadata')
    if (type === 'IDAT') sawIdat = true
    if (type === 'IEND') {
      if (length !== 0) return fail('malformed')
      if (end !== n) return fail('trailing_data')
      if (!sawIdat) return fail('malformed')
      return { ok: true, width, height }
    }
    pos = end
  }
}

function detectFormat(b: Uint8Array): CaptureImageFormat | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((v, i) => b[i] === v)) return 'png'
  return null
}

export function inspectCaptureImage(
  bytes: Uint8Array,
  expectedSize: readonly [number, number],
): CaptureImageInspection {
  if (bytes.length > CAPTURE_IMAGE_MAX_BYTES) return fail('too_large')
  const format = detectFormat(bytes)
  if (format === null) return fail('not_image')

  const parsed = format === 'jpeg' ? parseJpeg(bytes) : parsePng(bytes)
  if (!parsed.ok) return parsed

  const { width, height } = parsed
  const inRange = (v: number): boolean => v >= CAPTURE_IMAGE_MIN_PX && v <= CAPTURE_IMAGE_MAX_PX
  if (!inRange(width) || !inRange(height)) return fail('dimension_range')
  if (width !== expectedSize[0] || height !== expectedSize[1]) return fail('size_mismatch')
  return { ok: true, format, width, height }
}
