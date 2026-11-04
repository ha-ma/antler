// SVG・HTML に入れる文字の下ごしらえ（docs/specs/record/functional.md R6、spec-adversary [6]）。
// 制御文字は XML のエスケープでは消えず resvg が例外を投げうるので、先に取り除く。

const CONTROL = /[\u0000-\u001F\u007F]/g
const graphemes = new Intl.Segmenter('ja', { granularity: 'grapheme' })

function splitChars(text: string): string[] {
  return Array.from(graphemes.segment(text), (s) => s.segment)
}

export function stripControl(text: string): string {
  return text.replace(CONTROL, ' ')
}

/** XML / HTML の属性・本文に入れられる形にする（制御文字も取り除く） */
export function escapeXml(text: string): string {
  return stripControl(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 文字の幅の目安（em）。CJK・かな・ハングル・全角は 1、それ以外は 0.56 */
function charWidth(ch: string): number {
  const code = ch.codePointAt(0) ?? 0
  return code >= 0x1100 ? 1 : 0.56
}

/** 幅（em）に収まるよう行に分け、maxLines を超える分は最後の行の末尾を「…」にする */
export function wrapText(text: string, maxEm: number, maxLines: number): string[] {
  const lines: string[] = []
  let line = ''
  let width = 0
  const chars = splitChars(stripControl(text).trim())
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i] ?? ''
    const w = charWidth(ch)
    if (width + w > maxEm && line) {
      if (lines.length === maxLines - 1) {
        lines.push(`${trimToWidth(line, maxEm - 1)}…`)
        return lines
      }
      lines.push(line)
      line = ''
      width = 0
      if (ch === ' ') continue
    }
    line += ch
    width += w
  }
  if (line) lines.push(line)
  return lines
}

/** 幅（em）に収まる先頭（収まらなければ末尾を「…」） */
export function fitText(text: string, maxEm: number): string {
  return wrapText(text, maxEm, 1)[0] ?? ''
}

function trimToWidth(text: string, maxEm: number): string {
  let width = 0
  let out = ''
  for (const ch of splitChars(text)) {
    width += charWidth(ch)
    if (width > maxEm) break
    out += ch
  }
  return out
}
