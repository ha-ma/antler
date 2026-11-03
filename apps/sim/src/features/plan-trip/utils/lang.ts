import type { Lang } from '@antler/schema'
import type { BriefLocationState } from '../types'

/** HTML の lang 属性の値（zh は繁体字）。 */
export function htmlLang(lang: Lang): string {
  return lang === 'zh' ? 'zh-Hant' : lang
}

/** 遷移の state から 4 言語のタイトルを読む。形が違えば null。 */
export function readBriefTitles(state: unknown): BriefLocationState['titles'] | null {
  if (typeof state !== 'object' || state === null || !('titles' in state)) return null
  const titles = (state as { titles: unknown }).titles
  if (typeof titles !== 'object' || titles === null) return null
  const t = titles as Record<string, unknown>
  return ['ja', 'en', 'zh', 'ko'].every((l) => typeof t[l] === 'string')
    ? (t as BriefLocationState['titles'])
    : null
}
