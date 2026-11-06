import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { renderAsync } from '@resvg/resvg-js'
import type { Lang } from '@antler/schema'
import type { RecordView } from '@antler/trip'
import { bundledOgFontFiles, OG_FAMILIES } from './og-fonts.js'
import { OgImageRenderer } from './og-image-renderer.js'
import { buildShioriSvg } from './shiori-svg.js'

// og-font（docs/specs/og-font/functional.md）。同梱のフォントで、日本語・繁体字・ハングルが「□」にならないことを確かめる。
// 開発機（Mac）にはシステムのフォントがあって「□」が隠れるので、システムのフォントは読まず（loadSystemFonts: false）、
// 「その文字を持つフォントを渡さない」描画を基準にする。□ はどの文字でも同じ形なので、文字列を替えても画素が変わらない。

const API_DIR = join(import.meta.dirname, '../../../..')

function view(lang: Lang, title: string): RecordView {
  return {
    lang,
    eyebrow: 'eyebrow',
    title,
    heading: 'heading',
    shiori: { completed: true, rows: [] },
    stats: [],
  } as unknown as RecordView
}

async function pixels(lang: Lang, title: string, fontFiles: string[]): Promise<Buffer> {
  const image = await renderAsync(buildShioriSvg(view(lang, title)), {
    font: { loadSystemFonts: false, fontFiles },
    fitTo: { mode: 'original' },
  })
  return image.pixels
}

const fonts = bundledOgFontFiles()
const byName = (name: string) => fonts.filter((f) => f.includes(name))

describe('同梱のフォント（og-font）', () => {
  it('FONT-1: 3 つのフォントと OFL.txt が置いてあり、sha256 が取得のスクリプトの固定値と合う', () => {
    expect(fonts).toHaveLength(3)
    for (const name of ['JP', 'TC', 'KR']) {
      expect(byName(`NotoSans${name}-Bold.otf`)).toHaveLength(1)
    }
    expect(existsSync(join(API_DIR, 'assets/fonts/OFL.txt'))).toBe(true)
    const out = execFileSync(
      process.execPath,
      [join(API_DIR, 'scripts/fetch-og-fonts.mjs'), '--check'],
      { encoding: 'utf8' },
    )
    expect(out.match(/^ok /gm)).toHaveLength(4)
  })

  it('FONT-2: 関数の大きさ。3 つで 16 MB 以下（Vercel の関数の上限 250 MB の十分内）', () => {
    const total = fonts.reduce((sum, f) => sum + statSync(f).size, 0)
    expect(total).toBeLessThan(16 * 1024 * 1024)
  })

  it('FONT-3: 言語ごとの family の順。その言語の字形が先で、3 つとも並ぶ', () => {
    expect(OG_FAMILIES.ja[0]).toBe('Noto Sans JP')
    expect(OG_FAMILIES.en[0]).toBe('Noto Sans JP')
    expect(OG_FAMILIES.zh[0]).toBe('Noto Sans TC')
    expect(OG_FAMILIES.ko[0]).toBe('Noto Sans KR')
    for (const lang of ['ja', 'en', 'zh', 'ko'] as const) {
      expect([...OG_FAMILIES[lang]].sort()).toEqual([
        'Noto Sans JP',
        'Noto Sans KR',
        'Noto Sans TC',
      ])
    }
  })

  /** タイトルを空にした描画との差の画素（タイトルの文字だけが数えられる。英字の見出しなどは両方にある） */
  async function titleInk(lang: Lang, title: string, fontFiles: string[]): Promise<number> {
    const [titled, empty] = [
      await pixels(lang, title, fontFiles),
      await pixels(lang, ' ', fontFiles),
    ]
    let n = 0
    for (let i = 0; i < titled.length; i += 4) if (titled[i] !== empty[i]) n += 1
    return n
  }

  it('FONT-4a: ja のタイトルは字ごとに違う形で出る。フォントを渡さないと何も描かれない', async () => {
    const a = await pixels('ja', '釧路湿原の朝', fonts)
    const b = await pixels('ja', '知床の夕暮れ', fonts)
    expect(a.equals(b)).toBe(false)
    expect(await titleInk('ja', '釧路湿原の朝', fonts)).toBeGreaterThan(5000)
    expect(await titleInk('ja', '釧路湿原の朝', [])).toBe(0)
  })

  it('FONT-4b: zh（繁体字）のタイトルは TC のフォントで出る', async () => {
    const a = await pixels('zh', '釧路濕原的清晨', fonts)
    const b = await pixels('zh', '知床的黃昏時分', fonts)
    expect(a.equals(b)).toBe(false)
    expect(await titleInk('zh', '釧路濕原的清晨', fonts)).toBeGreaterThan(5000)
    expect(await titleInk('zh', '釧路濕原的清晨', [])).toBe(0)
  })

  it('FONT-3b: family 名が実際のフォントの名前と合っている（TC を先にした zh と JP を先にした zh は、共通の字でも字形が違う）', async () => {
    const svg = (family: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120"><rect width="400" height="120" fill="#fff"/><text x="10" y="90" font-family="${family}" font-size="80" font-weight="700">骨直海</text></svg>`
    const render = async (family: string) =>
      (
        await renderAsync(svg(family), {
          font: { loadSystemFonts: false, fontFiles: fonts },
          fitTo: { mode: 'original' },
        })
      ).pixels
    const tcFirst = await render("'Noto Sans TC', 'Noto Sans JP'")
    const jpFirst = await render("'Noto Sans JP', 'Noto Sans TC'")
    expect(tcFirst.equals(jpFirst)).toBe(false)
    // 名前を間違えると、どちらも同じ（読み込んだ順の）フォントに落ちる
    const wrongA = await render("'Noto Sans TCX', 'Noto Sans JPX'")
    const wrongB = await render("'Noto Sans JPX', 'Noto Sans TCX'")
    expect(wrongA.equals(wrongB)).toBe(true)
  })

  it('S-1: 同梱のフォントが欠けている・OG_FONT_FILES のパスが無い → 警告を 1 回出し、画像は返す', async () => {
    const warned = vi.fn()
    const renderer = new OgImageRenderer({
      fontFiles: ['/no/such/font.ttf'],
      bundledFonts: () => [],
      onFontsMissing: warned,
    })
    const png = await renderer.png('t:1:0', () => buildShioriSvg(view('en', 'Hokkaido')))
    expect(png.length).toBeGreaterThan(1000)
    expect(warned).toHaveBeenCalledTimes(1)
    // 同梱が使えるときは、指定のパスが無くても同梱に戻る（警告なし）
    const ok = vi.fn()
    new OgImageRenderer({ fontFiles: ['/no/such/font.ttf'], onFontsMissing: ok })
    expect(ok).not.toHaveBeenCalled()
  })

  it('FONT-4c: ko のタイトルは KR のフォントで出る。KR を外すと □ になり、文字列を替えても画素が変わらない（検査自体が効く）', async () => {
    const withKr = [
      await pixels('ko', '가나다라마바사', fonts),
      await pixels('ko', '아자차카타파하', fonts),
    ]
    expect(withKr[0]?.equals(withKr[1] ?? Buffer.alloc(0))).toBe(false)
    const noKr = fonts.filter((f) => !f.includes('NotoSansKR'))
    const tofuA = await pixels('ko', '가나다라마바사', noKr)
    const tofuB = await pixels('ko', '아자차카타파하', noKr)
    expect(tofuA.equals(tofuB)).toBe(true)
  })

  it('FONT-4d: 日本語のタイトルに混じったハングルも、JP が先でも KR に落ちて出る（文字ごとの代わり）', async () => {
    const mixed = await pixels('ja', '北海道 가나다라', fonts)
    const noKr = await pixels(
      'ja',
      '北海道 마바사아',
      fonts.filter((f) => !f.includes('NotoSansKR')),
    )
    const noKr2 = await pixels(
      'ja',
      '北海道 가나다라',
      fonts.filter((f) => !f.includes('NotoSansKR')),
    )
    expect(noKr.equals(noKr2)).toBe(true)
    expect(mixed.equals(noKr2)).toBe(false)
  })

  it('FONT-5: 既定の OgImageRenderer（fontFiles 空）は同梱のフォントで 1200×630 の PNG を描く。1 枚は 1 秒以内', async () => {
    const renderer = new OgImageRenderer({ fontFiles: [] })
    const started = performance.now()
    const png = await renderer.png('t:1:0', () => buildShioriSvg(view('ko', '홋카이도 여행')))
    expect(performance.now() - started).toBeLessThan(1000)
    expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(new DataView(png.buffer).getUint32(16)).toBe(1200)
    expect(new DataView(png.buffer).getUint32(20)).toBe(630)
  })
})
