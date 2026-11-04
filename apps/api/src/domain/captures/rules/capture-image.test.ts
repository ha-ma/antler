import { buildJpeg, buildPng } from '../../../../tests/factories/captures.js'
import { inspectCaptureImage } from './capture-image.js'

const SIZE: [number, number] = [320, 240]

function reasonOf(bytes: Uint8Array, size: [number, number] = SIZE): string | undefined {
  const r = inspectCaptureImage(bytes, size)
  return r.ok ? undefined : r.reason
}

describe('inspectCaptureImage', () => {
  it('IMG-1a: 最小の JPEG（JFIF）と PNG の寸法を読める', () => {
    expect(inspectCaptureImage(buildJpeg(), SIZE)).toEqual({
      ok: true,
      format: 'jpeg',
      width: 320,
      height: 240,
    })
    expect(inspectCaptureImage(buildPng(), SIZE)).toEqual({
      ok: true,
      format: 'png',
      width: 320,
      height: 240,
    })
    // 画素に FF00・RST・フィルが混ざる JPEG、許可チャンクだけの PNG も通る
    expect(inspectCaptureImage(buildJpeg({ scanWithMarkers: true }), SIZE).ok).toBe(true)
    expect(
      inspectCaptureImage(
        buildPng({ chunks: ['PLTE', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'sBIT', 'bKGD', 'pHYs'] }),
        SIZE,
      ).ok,
    ).toBe(true)
    // JFIF 無しの JPEG（メタデータなし）も通る
    expect(inspectCaptureImage(buildJpeg({ app0: 'none' }), SIZE).ok).toBe(true)
  })

  it('IMG-1b: 先頭のバイトが JPEG/PNG でないものは拒否（名前や Content-Type は見ない）', () => {
    const gif = new Uint8Array(46)
    gif.set(new TextEncoder().encode('GIF89a'))
    expect(reasonOf(gif)).toBe('not_image')
    expect(reasonOf(new Uint8Array())).toBe('not_image')
    expect(reasonOf(new TextEncoder().encode('<?php echo 1; ?>'))).toBe('not_image')
    // PNG の署名が途中までしか合っていない
    expect(reasonOf(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x00, 0x0a]))).toBe(
      'not_image',
    )
  })

  it('IMG-1c: 寸法が imageSize と違うものは拒否', () => {
    expect(reasonOf(buildJpeg({ width: 321 }))).toBe('size_mismatch')
    expect(reasonOf(buildPng({ height: 239 }))).toBe('size_mismatch')
    expect(reasonOf(buildJpeg(), [240, 320])).toBe('size_mismatch')
  })

  it('IMG-1d: JPEG の Exif・XMP・ICC・コメントは拒否。JFIF だけなら通る', () => {
    expect(reasonOf(buildJpeg({ exif: true }))).toBe('metadata')
    expect(reasonOf(buildJpeg({ xmp: true }))).toBe('metadata')
    expect(reasonOf(buildJpeg({ icc: true }))).toBe('metadata')
    expect(reasonOf(buildJpeg({ comment: true }))).toBe('metadata')
    expect(reasonOf(buildJpeg())).toBeUndefined()
  })

  it('IMG-1d: PNG の eXIf・tEXt・zTXt・iTXt・tIME・iCCP は拒否。許可チャンクだけなら通る', () => {
    for (const type of ['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME', 'iCCP', 'zzZz']) {
      expect(reasonOf(buildPng({ chunks: [type] }))).toBe('metadata')
    }
    expect(reasonOf(buildPng({ chunks: ['pHYs', 'tRNS'] }))).toBeUndefined()
  })

  it('IMG-1e: 途中で切れた・SOF が無い・IHDR が無い・チャンク長が本文を超える画像は例外ではなく結果として拒否', () => {
    const jpeg = buildJpeg()
    for (const cut of [4, 10, 30, jpeg.length - 3]) {
      expect(() => inspectCaptureImage(jpeg.slice(0, cut), SIZE)).not.toThrow()
      expect(reasonOf(jpeg.slice(0, cut))).toBe('malformed')
    }
    expect(reasonOf(buildJpeg({ omitSof: true }))).toBe('malformed')
    expect(reasonOf(buildJpeg({ omitEoi: true }))).toBe('malformed')
    expect(reasonOf(buildJpeg({ omitScan: true }))).toBe('malformed')

    const png = buildPng()
    for (const cut of [8, 12, 20, 33, png.length - 5]) {
      expect(() => inspectCaptureImage(png.slice(0, cut), SIZE)).not.toThrow()
      expect(reasonOf(png.slice(0, cut))).toBe('malformed')
    }
    expect(reasonOf(buildPng({ omitIhdr: true }))).toBe('malformed')
    expect(reasonOf(buildPng({ omitIend: true }))).toBe('malformed')
    expect(reasonOf(buildPng({ omitIdat: true }))).toBe('malformed')
    expect(reasonOf(buildPng({ overlongChunk: true }))).toBe('malformed')
  })

  it('IMG-1f: EOI・IEND の後ろに 1 バイトでも付いていたら拒否', () => {
    expect(reasonOf(buildJpeg({ trailing: [0] }))).toBe('trailing_data')
    expect(reasonOf(buildJpeg({ trailing: [0xff, 0xd9] }))).toBe('trailing_data')
    expect(reasonOf(buildPng({ trailing: [0] }))).toBe('trailing_data')
  })

  it('IMG-1f: JFXX・2 つ目の APP0・0×0 でない JFIF のサムネイルは拒否', () => {
    expect(reasonOf(buildJpeg({ app0: 'jfxx' }))).toBe('metadata')
    expect(reasonOf(buildJpeg({ app0: 'jfif-twice' }))).toBe('metadata')
    expect(reasonOf(buildJpeg({ app0: 'jfif-thumbnail' }))).toBe('metadata')
  })

  it('IMG-1f: 寸法が 16 未満・2048 超は拒否（16 と 2048 は通る）', () => {
    expect(reasonOf(buildJpeg({ width: 15, height: 240 }), [15, 240])).toBe('dimension_range')
    expect(reasonOf(buildPng({ width: 320, height: 8 }), [320, 8])).toBe('dimension_range')
    expect(reasonOf(buildJpeg({ width: 2049, height: 16 }), [2049, 16])).toBe('dimension_range')
    expect(reasonOf(buildPng({ width: 16, height: 2049 }), [16, 2049])).toBe('dimension_range')
    expect(reasonOf(buildJpeg({ width: 16, height: 16 }), [16, 16])).toBeUndefined()
    expect(reasonOf(buildPng({ width: 2048, height: 2048 }), [2048, 2048])).toBeUndefined()
    // sim の 1280×720 は通る
    expect(reasonOf(buildJpeg({ width: 1280, height: 720 }), [1280, 720])).toBeUndefined()
  })

  it('IMG-1e: 1 MB を超えるファイルは拒否（寸法を読む前に止める）', () => {
    const big = new Uint8Array(1024 * 1024 + 1)
    big.set(buildJpeg())
    expect(reasonOf(big)).toBe('too_large')
  })

  it('IMG-1e: 壊れた構造（長さ 0 のセグメント・不正なマーカー）も例外にしない', () => {
    // SOI のあとに FF 以外
    expect(reasonOf(Uint8Array.from([0xff, 0xd8, 0xff, 0x00, 0x00, 0x00]))).toBe('malformed')
    // 長さが 1 のセグメント（最小は 2）
    expect(reasonOf(Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0xff, 0xd9]))).toBe(
      'malformed',
    )
    // SOF の中身が短い
    expect(
      reasonOf(Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x04, 0x08, 0x00, 0xff, 0xd9])),
    ).toBe('malformed')
  })
})
