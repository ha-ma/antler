import type { Lang } from '@antler/schema'
import type { Spotting } from '../types'

// 鹿の発見の HUD の文言（drive-crash-spot R4。4 言語、zh は繁体字。docs/specs/i18n/functional.md R5）。
// count は `{found}`（見つけた頭数）と `{appeared}`（見えた頭数）を spotCount で差し込む。

// 1 行の文そのものが名前を兼ねる（<p> に aria-label は付けられない。ARIA 1.2）
export const SPOT_TEXT: Record<Lang, { count: string }> = {
  ja: { count: '鹿を発見 {found} / {appeared} 頭' },
  en: { count: 'Deer spotted {found} / {appeared}' },
  zh: { count: '發現鹿 {found} / {appeared} 頭' },
  ko: { count: '사슴 발견 {found} / {appeared}마리' },
}

/** 「鹿を発見 n / m 頭」の 1 行 */
export function spotCount(lang: Lang, s: Pick<Spotting, 'found' | 'appeared'>): string {
  return SPOT_TEXT[lang].count
    .replace('{found}', String(s.found))
    .replace('{appeared}', String(s.appeared))
}
