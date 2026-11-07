import { Resvg } from '@resvg/resvg-js'
import type { Lang } from '@antler/schema'
import type { RecordView } from '@antler/trip'
import { bundledOgFontFiles } from './og-fonts.js'
import { buildShioriSvg, OG_BRAND_X, OG_EYEBROW_X, OG_HEIGHT, OG_WIDTH } from './shiori-svg.js'

// rebrand-shikashi R4: OG 画像の左上のブランドが長くなった（SHIKASHI SIMULATOR）。右の eyebrow と重ならないことを、
// 同梱のフォントで実際に描いた幅で確かめる（文字数の見積もりに頼らない）。

function view(lang: Lang): RecordView {
  return {
    lang,
    eyebrow: 'TRIP RECORD ・ 2027.02.14 – 02.18',
    title: 'title',
    heading: 'heading',
    shiori: { completed: true, rows: [] },
    stats: [],
  } as unknown as RecordView
}

/** SVG の中の、x が OG_BRAND_X の <text>（ブランド）だけを描いたときの右端 */
function brandRightEdge(svg: string): number {
  const brand = new RegExp(`<text x="${String(OG_BRAND_X)}" y="78"[^>]*>[^<]*</text>`).exec(
    svg,
  )?.[0]
  if (!brand) throw new Error('ブランドの text が無い')
  const only = `<svg xmlns="http://www.w3.org/2000/svg" width="${String(OG_WIDTH)}" height="${String(OG_HEIGHT)}">${brand}</svg>`
  const box = new Resvg(only, {
    font: { loadSystemFonts: false, fontFiles: bundledOgFontFiles() },
  }).getBBox()
  if (!box) throw new Error('ブランドが描かれていない')
  return box.x + box.width
}

describe('buildShioriSvg のブランド（rebrand-shikashi）', () => {
  it.each(['ja', 'en', 'zh', 'ko'] as const)(
    'BRAND-6: %s の左上は SHIKASHI SIMULATOR で、eyebrow はブランドの右端より右から始まる',
    (lang) => {
      const svg = buildShioriSvg(view(lang))
      expect(svg).toContain('>SHIKASHI SIMULATOR</text>')
      expect(svg).not.toMatch(/EZO ?ROAD/i)
      expect(svg).toContain(`<text x="${String(OG_EYEBROW_X)}" y="78"`)
      const right = brandRightEdge(svg)
      expect(right).toBeGreaterThan(OG_BRAND_X + 200) // 描けている（□ や空ではない）
      expect(right + 24).toBeLessThan(OG_EYEBROW_X) // 24px 以上の間
    },
  )
})
