import type { Lang } from '@antler/schema'
import rates from '../data/rates.json'

// 初期言語と予算の表示（functional.md R6、A1-6）。

/** 概算 USD のレート（出典の確認は Deferred。verified:false のあいだ画面は「概算」と書く）。 */
export const USD_RATE = rates

/** ブラウザの言語（navigator.languages）から初期言語を決める。zh は繁体字のときだけ、それ以外は ja。 */
export function initialLang(languages: readonly string[]): Lang {
  for (const raw of languages) {
    const tag = raw.toLowerCase()
    if (tag.startsWith('ja')) return 'ja'
    if (tag.startsWith('en')) return 'en'
    if (tag.startsWith('ko')) return 'ko'
    if (tag.startsWith('zh')) {
      if (/^zh-(?:tw|hk|mo)\b|^zh-hant\b/.test(tag)) return 'zh'
      return 'ja'
    }
  }
  return 'ja'
}

const ABOUT: Record<Lang, string> = { ja: '約', en: 'approx.', zh: '約', ko: '약' }

/** 「¥120,000（約 $800）」の形。USD は 10 ドル単位に丸める。 */
export function formatBudget(jpy: number, lang: Lang): string {
  const usd = Math.round(jpy / USD_RATE.jpyPerUsd / 10) * 10
  return `¥${jpy.toLocaleString('en-US')}（${ABOUT[lang]} $${usd.toLocaleString('en-US')}）`
}
