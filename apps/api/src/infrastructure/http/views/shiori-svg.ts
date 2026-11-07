import { tokens } from '@antler/alert-ui/tokens'
import { recordText, type RecordView } from '@antler/trip'
import { OG_FAMILIES } from './og-fonts.js'
import { escapeXml, fitText, wrapText } from './text-fit.js'

// しおりの OG 画像（1200×630）の SVG（docs/specs/record/functional.md R6）。PNG への変換は og-image-renderer.ts。
// 色は tokens.json（trip テーマ）だけ。alert-danger は使わない（衝突の印も clay-deep）。
// 文字はすべて escapeXml を通す（タイトルは Claude の生成物。信用しない）。

export const OG_WIDTH = 1200
export const OG_HEIGHT = 630
/** 日の行の上限（超えたら最後の行を「ほか n 日」にする） */
export const OG_MAX_DAY_ROWS = 7
/** 左上のブランド（SHIKASHI SIMULATOR、26px・字間 2）と、その右の eyebrow の始まり。
 * ブランドは約 360px の幅になるので、eyebrow は 440 から（docs/specs/rebrand-shikashi R4） */
export const OG_BRAND_X = 60
export const OG_EYEBROW_X = 440

const c = tokens.color.trip

/** 同梱のフォント（og-fonts.ts）だけを、言語の字形が先になる順に並べる。数字（旧 IBM Plex Mono）も同じフォント */
function fontFamily(lang: RecordView['lang']): string {
  return `${OG_FAMILIES[lang].map((f) => `'${f}'`).join(', ')}, sans-serif`
}

type Row = RecordView['shiori']['rows'][number]

function mark(result: Row['result'], x: number, y: number): string {
  if (result === 'completed') {
    return `<circle cx="${String(x)}" cy="${String(y)}" r="12" fill="${c.spruce}"/><path d="M${String(x - 6)} ${String(y)} l4 4 l8 -9" fill="none" stroke="${c['on-spruce']}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`
  }
  if (result === 'collided') {
    return `<path d="M${String(x - 8)} ${String(y - 8)} l16 16 M${String(x + 8)} ${String(y - 8)} l-16 16" stroke="${c['clay-deep']}" stroke-width="3.5" stroke-linecap="round"/>`
  }
  return `<path d="M${String(x - 8)} ${String(y)} h16" stroke="${c['ink-faint']}" stroke-width="3" stroke-linecap="round"/>`
}

export function buildShioriSvg(view: RecordView): string {
  const family = fontFamily(view.lang)
  const text = (
    x: number,
    y: number,
    size: number,
    fill: string,
    body: string,
    extra = '',
  ): string =>
    `<text x="${String(x)}" y="${String(y)}" font-family="${family}" font-size="${String(size)}" fill="${fill}"${extra}>${escapeXml(body)}</text>`
  const parts: string[] = []
  parts.push(`<rect width="${String(OG_WIDTH)}" height="${String(OG_HEIGHT)}" fill="${c.ground}"/>`)
  parts.push(`<rect x="0" y="0" width="${String(OG_WIDTH)}" height="10" fill="${c.spruce}"/>`)
  parts.push(
    text(
      OG_BRAND_X,
      78,
      26,
      c.spruce,
      recordText('brand', view.lang),
      ' font-weight="700" letter-spacing="2"',
    ),
  )
  parts.push(text(OG_EYEBROW_X, 78, 22, c['ink-muted'], fitText(view.eyebrow, 38)))

  const titleLines = wrapText(view.title, 21, 2)
  titleLines.forEach((line, i) => {
    parts.push(text(60, 150 + i * 62, 50, c.ink, line, ' font-weight="900"'))
  })
  const headingY = 150 + titleLines.length * 62
  parts.push(
    text(
      60,
      headingY,
      30,
      view.shiori.completed ? c.spruce : c['clay-deep'],
      view.heading,
      ' font-weight="700"',
    ),
  )

  // 日の行（左）
  const rows = view.shiori.rows
  const overflow = rows.length > OG_MAX_DAY_ROWS
  const shown = overflow ? rows.slice(0, OG_MAX_DAY_ROWS - 1) : rows
  const rowStart = headingY + 52
  const rowStep = Math.min(42, (OG_HEIGHT - 30 - rowStart) / OG_MAX_DAY_ROWS)
  shown.forEach((row, i) => {
    const y = rowStart + i * rowStep
    parts.push(mark(row.result, 76, y - 8))
    const off = row.alertOff ? ` ・ ${recordText('alertOff', view.lang)}` : ''
    parts.push(text(104, y, 24, c.ink, fitText(`${row.title}${off}`, 27)))
  })
  if (overflow) {
    const y = rowStart + shown.length * rowStep
    parts.push(
      text(
        104,
        y,
        24,
        c['ink-muted'],
        recordText('moreDays', view.lang, { n: rows.length - shown.length }),
      ),
    )
  }

  // 守れた楽しみ（右）
  const stat = view.stats.find((s) => s.key === 'pleasures')
  if (stat) {
    parts.push(
      `<rect x="830" y="${String(rowStart - 40)}" width="310" height="170" rx="18" fill="${c.surface}" stroke="${c.line}" stroke-width="2"/>`,
    )
    parts.push(text(860, rowStart + 2, 22, c['ink-muted'], fitText(stat.label, 11)))
    parts.push(
      `<text x="860" y="${String(rowStart + 92)}" font-family="${family}" font-size="64" font-weight="700" fill="${c.spruce}">${escapeXml(stat.value)}</text>`,
    )
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(OG_WIDTH)}" height="${String(OG_HEIGHT)}" viewBox="0 0 ${String(OG_WIDTH)} ${String(OG_HEIGHT)}">${parts.join('')}</svg>`
}
