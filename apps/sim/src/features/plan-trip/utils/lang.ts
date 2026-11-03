import type { Lang } from '@antler/schema'

/** HTML の lang 属性の値（zh は繁体字）。 */
export function htmlLang(lang: Lang): string {
  return lang === 'zh' ? 'zh-Hant' : lang
}
