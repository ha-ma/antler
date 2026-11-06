import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLEASURES } from '@antler/trip'
import photosJson from '../data/photos.json'
import { imageKind, imageSize, isAllowedLicense } from './photo-rules'
import { PHOTOS, photoOf } from './photos'

// plan-trip-photos R5・R6・R9: 写真の記録と、同梱した画像・CREDITS.md の整合。

const here = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.resolve(here, '../../../../public')
const credits = readFileSync(path.resolve(here, '../../../../../../CREDITS.md'), 'utf8')

describe('楽しみの写真の記録（photos.json）', () => {
  it('PH-1: 各記録は欄がそろい、ライセンスは CC0・パブリックドメイン・CC BY だけ、id はマスターにあり重複しない', () => {
    // 読み込み時の検証（photos.ts）を通った件数と、ファイルの件数が同じ
    expect(PHOTOS).toHaveLength((photosJson as unknown[]).length)
    const ids = new Set(PLEASURES.map((p) => p.id))
    expect(new Set(PHOTOS.map((p) => p.id)).size).toBe(PHOTOS.length)
    for (const p of PHOTOS) {
      expect(ids.has(p.id), p.id).toBe(true)
      expect(isAllowedLicense({ code: p.licenseCode, name: p.license }), p.id).toBe(true)
      expect(p.license, p.id).not.toMatch(/SA|NC|ND|GFDL/)
      expect(p.author.trim(), p.id).not.toBe('')
      expect(p.sourceUrl, p.id).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/)
      expect(p.review, p.id).not.toBe('')
      // CC BY はライセンス本文の URL を持つ
      if (p.licenseCode.startsWith('cc-by')) expect(p.licenseUrl, p.id).toMatch(/^https:\/\//)
    }
    // 使えないライセンスの記録は読み込みで落ちる
    expect(isAllowedLicense({ code: 'cc-by-sa-4.0', name: 'CC BY-SA 4.0' })).toBe(false)
  })

  it('PH-2: 各画像が public/photos/ にあり、SHA-256 が記録と一致し、中身は JPEG・PNG で幅は 800px 以下', () => {
    for (const p of PHOTOS) {
      const bytes = new Uint8Array(readFileSync(path.join(publicDir, p.file)))
      expect(createHash('sha256').update(bytes).digest('hex'), p.id).toBe(p.sha256)
      expect(imageKind(bytes), p.id).toBe(p.file.endsWith('.png') ? 'png' : 'jpg')
      const size = imageSize(bytes)
      expect(size, p.id).toEqual({ width: p.width, height: p.height })
      expect(p.width, p.id).toBeLessThanOrEqual(800)
    }
  })

  it('PH-3: CREDITS.md に各写真の出典 URL・撮影者・ライセンスがある', () => {
    for (const p of PHOTOS) {
      const row = credits.split('\n').find((line) => line.startsWith(`| ${p.id} |`))
      expect(row, p.id).toBeDefined()
      expect(row, p.id).toContain(p.sourceUrl)
      expect(row, p.id).toContain(p.author)
      expect(row, p.id).toContain(p.license)
      expect(row, p.id).toContain('縮小')
    }
  })

  it('記録の無い楽しみは null（photo-placeholder のまま）', () => {
    expect(photoOf('no-such-pleasure')).toBeNull()
  })
})
