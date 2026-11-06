import {
  MAX_PHOTO_BYTES,
  imageKind,
  imageSize,
  isAllowedLicense,
  isAllowedSource,
  plainText,
  stripJpegMetadata,
} from './photo-rules'

// plan-trip-photos R5・R8: 取得のスクリプトと写真の記録の検証が使う判定（純粋関数）。

const jpeg = (...segments: number[][]) =>
  new Uint8Array([0xff, 0xd8, ...segments.flat(), 0xff, 0xd9])
/** マーカー＋長さ（2 バイト。長さ自身を含む）＋中身 */
const segment = (marker: number, body: number[]) => [
  0xff,
  marker,
  (body.length + 2) >> 8,
  (body.length + 2) & 0xff,
  ...body,
]
/** SOF0: 精度 8、高さ、幅、成分 1 */
const sof = (width: number, height: number) =>
  segment(0xc0, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0])

describe('PH-6 取得のスクリプトの判定', () => {
  it('ライセンス: CC0・パブリックドメイン・CC BY（地域版も）は可、SA・NC・ND・GFDL は不可', () => {
    expect(isAllowedLicense({ code: 'cc0', name: 'CC0' })).toBe(true)
    expect(isAllowedLicense({ code: 'pd', name: 'Public domain' })).toBe(true)
    expect(isAllowedLicense({ code: 'cc-by-4.0', name: 'CC BY 4.0' })).toBe(true)
    expect(isAllowedLicense({ code: 'cc-by-2.0', name: 'CC BY 2.0' })).toBe(true)
    expect(isAllowedLicense({ code: 'cc-by-3.0-jp', name: 'CC BY 3.0 JP' })).toBe(true)
    expect(isAllowedLicense({ code: 'cc-by-sa-4.0', name: 'CC BY-SA 4.0' })).toBe(false)
    expect(isAllowedLicense({ code: 'cc-by-nc-2.0', name: 'CC BY-NC 2.0' })).toBe(false)
    expect(isAllowedLicense({ code: 'cc-by-nd-2.0', name: 'CC BY-ND 2.0' })).toBe(false)
    expect(isAllowedLicense({ code: 'gfdl', name: 'GFDL' })).toBe(false)
    expect(isAllowedLicense({ code: '', name: 'CC BY 4.0' })).toBe(false)
    // コードと名前が食い違うときは不可（名前に SA が入っている）
    expect(isAllowedLicense({ code: 'cc-by-4.0', name: 'CC BY-SA 4.0' })).toBe(false)
  })

  it('通信先: API は commons.wikimedia.org、画像は upload・thumb.wikimedia.org の https だけ', () => {
    expect(isAllowedSource('https://commons.wikimedia.org/w/api.php?x=1', 'api')).toBe(true)
    expect(
      isAllowedSource('https://upload.wikimedia.org/wikipedia/commons/thumb/a.jpg', 'image'),
    ).toBe(true)
    expect(
      isAllowedSource('https://thumb.wikimedia.org/wikipedia/commons/thumb/a.jpg', 'image'),
    ).toBe(true)
    expect(isAllowedSource('https://thumb.wikimedia.org/a.jpg', 'api')).toBe(false)
    expect(isAllowedSource('http://upload.wikimedia.org/a.jpg', 'image')).toBe(false)
    expect(isAllowedSource('https://upload.wikimedia.org.evil.example/a.jpg', 'image')).toBe(false)
    expect(isAllowedSource('https://evil.example/upload.wikimedia.org/a.jpg', 'image')).toBe(false)
    expect(isAllowedSource('https://commons.wikimedia.org/w/api.php', 'image')).toBe(false)
    expect(isAllowedSource('https://user@upload.wikimedia.org/a.jpg', 'image')).toBe(false)
    expect(isAllowedSource('not a url', 'api')).toBe(false)
  })

  it('中身: 先頭のバイトで JPEG・PNG を見分け、HTML・SVG は不可。上限は 2 MB', () => {
    expect(imageKind(jpeg(sof(640, 427)))).toBe('jpg')
    expect(imageKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png')
    expect(imageKind(new TextEncoder().encode('<!doctype html><svg/>'))).toBeNull()
    expect(imageKind(new Uint8Array([]))).toBeNull()
    expect(MAX_PHOTO_BYTES).toBe(2 * 1024 * 1024)
  })

  it('大きさ: JPEG の SOF と PNG の IHDR から幅・高さを読む', () => {
    expect(imageSize(jpeg(segment(0xe0, [0, 0]), sof(640, 427)))).toEqual({
      width: 640,
      height: 427,
    })
    const png = new Uint8Array(24)
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
    png.set([0, 0, 2, 128, 0, 0, 1, 224], 16)
    expect(imageSize(png)).toEqual({ width: 640, height: 480 })
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull()
  })

  it('メタデータ: JPEG の APP1（EXIF・XMP）と APP13（IPTC）を落とし、APP0・ICC（APP2）・画像は残す', () => {
    const app0 = segment(0xe0, [0x4a, 0x46])
    const exif = segment(0xe1, [0x45, 0x78, 0x69, 0x66, 9, 9])
    const icc = segment(0xe2, [0x49, 0x43])
    const iptc = segment(0xed, [1, 2])
    const frame = sof(640, 427)
    const scan = [0xff, 0xda, 0, 2, 0x12, 0x34, 0xff, 0x00, 0x56]
    const input = new Uint8Array([0xff, 0xd8, ...app0, ...exif, ...icc, ...iptc, ...frame, ...scan])
    expect(Array.from(stripJpegMetadata(input))).toEqual([
      0xff,
      0xd8,
      ...app0,
      ...icc,
      ...frame,
      ...scan,
    ])
    // JPEG でなければそのまま
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    expect(stripJpegMetadata(png)).toBe(png)
  })

  it('撮影者: HTML のタグを落とし、実体参照を戻し、空白を詰める', () => {
    expect(
      plainText('<a href="//commons.wikimedia.org/wiki/User:X" title="User:X">X</a> &amp; Y'),
    ).toBe('X & Y')
    expect(plainText('<span>Douglas&nbsp;P.\n Perkins</span>')).toBe('Douglas P. Perkins')
    expect(plainText('&lt;script&gt;')).toBe('<script>')
  })
})
