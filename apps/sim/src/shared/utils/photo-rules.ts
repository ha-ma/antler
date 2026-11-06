// 楽しみの写真の判定（docs/specs/plan-trip-photos/functional.md R5・R8）。
// 取得のスクリプト（apps/sim/scripts/fetch-photos.ts）と、写真の記録の検証（features/plan-trip/utils/photos.ts）が
// 同じ判定を使う。スクリプトは feature の内部を import できないので shared に置く。
// 純粋関数だけを置く（通信・ファイルは扱わない）。

/** 保存する画像の上限（受信中のバイト数で効かせる） */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024

/**
 * 使えるライセンスか（CC0・パブリックドメイン・CC BY。ch6）。
 * 判定は Commons の extmetadata の `License`（コード）で行い、表示名（`LicenseShortName`）に
 * SA・NC・ND・GFDL が入っていたら、コードが許可でも不可にする（食い違いは疑う）。
 */
export function isAllowedLicense(license: { code: string; name: string }): boolean {
  const code = license.code.trim().toLowerCase()
  const codeOk = code === 'cc0' || code === 'pd' || /^cc-by-\d\.\d(?:-[a-z]{2,})?$/.test(code)
  const nameBad = /\b(?:SA|NC|ND|GFDL)\b/i.test(license.name)
  return codeOk && !nameBad
}

/** 通信先のホスト（完全一致）。サムネイルは thumb.wikimedia.org から配られる（2026-11 時点） */
const SOURCE_HOSTS = {
  api: ['commons.wikimedia.org'],
  image: ['upload.wikimedia.org', 'thumb.wikimedia.org'],
} as const

/** 通信してよい URL か（https・ホストの完全一致・ユーザー情報なし）。 */
export function isAllowedSource(url: string, kind: keyof typeof SOURCE_HOSTS): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return (
    parsed.protocol === 'https:' &&
    (SOURCE_HOSTS[kind] as readonly string[]).includes(parsed.hostname) &&
    parsed.port === '' &&
    parsed.username === '' &&
    parsed.password === ''
  )
}

/** 先頭のバイトで画像の種類を見分ける（Content-Type は信じない）。 */
export function imageKind(bytes: Uint8Array): 'jpg' | 'png' | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (png.every((b, i) => bytes[i] === b)) return 'png'
  return null
}

const u16 = (bytes: Uint8Array, at: number) => ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0)
const u32 = (bytes: Uint8Array, at: number) => u16(bytes, at) * 65536 + u16(bytes, at + 2)

/** JPEG のセグメント（SOI のあと、SOS の手前まで）を順に返す。 */
function jpegSegments(bytes: Uint8Array): { marker: number; start: number; end: number }[] {
  const segments: { marker: number; start: number; end: number }[] = []
  let at = 2
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1] ?? 0
    if (marker === 0xda || marker === 0xd9) break
    const end = at + 2 + u16(bytes, at + 2)
    if (end > bytes.length) break
    segments.push({ marker, start: at, end })
    at = end
  }
  return segments
}

/** 実物から幅・高さを読む（JPEG は SOF、PNG は IHDR）。読めなければ null。 */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const kind = imageKind(bytes)
  if (kind === 'png') {
    if (bytes.length < 24) return null
    return { width: u32(bytes, 16), height: u32(bytes, 20) }
  }
  if (kind === 'jpg') {
    const frame = jpegSegments(bytes).find(
      (s) => s.marker >= 0xc0 && s.marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(s.marker),
    )
    if (!frame) return null
    return { height: u16(bytes, frame.start + 5), width: u16(bytes, frame.start + 7) }
  }
  return null
}

/**
 * JPEG から APP1（EXIF・XMP。撮影位置などを含みうる）と APP13（IPTC）を落とす。
 * APP0（JFIF）・APP2（ICC の色）・画像のデータはそのまま残す。JPEG でなければ入力をそのまま返す。
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (imageKind(bytes) !== 'jpg') return bytes
  const segments = jpegSegments(bytes)
  const dropped = segments.filter((s) => s.marker === 0xe1 || s.marker === 0xed)
  if (dropped.length === 0) return bytes
  const parts: Uint8Array[] = [bytes.subarray(0, 2)]
  for (const s of segments) {
    if (!dropped.includes(s)) parts.push(bytes.subarray(s.start, s.end))
  }
  const restStart = segments.at(-1)?.end ?? 2
  parts.push(bytes.subarray(restStart))
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
}

/** Commons の `Artist`・`Attribution`（HTML）を平文にする。画面では文字として出す（HTML にしない）。 */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
      const known = ENTITIES[name.toLowerCase()]
      if (known !== undefined) return known
      if (name.startsWith('#x') || name.startsWith('#X'))
        return String.fromCodePoint(parseInt(name.slice(2), 16))
      if (name.startsWith('#')) return String.fromCodePoint(parseInt(name.slice(1), 10))
      return whole
    })
    .replace(/\s+/g, ' ')
    .trim()
}
