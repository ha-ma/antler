import type { Lang } from '@antler/schema'

// ゾーンの前のおすすめのカードの文言（docs/specs/drive-tourism/functional.md T13）。4 言語。zh は繁体字。絵文字なし。

type L = Record<Lang, string>

export const RECOMMEND_TEXT = {
  /** 見出し（eyebrow）と、カードの aria-label */
  title: { ja: 'この先のおすすめ', en: 'Coming up', zh: '前方推薦', ko: '이 앞의 추천' } as L,
  /** 所要の目安の前後（数は等幅で間に入れる。「所要 約 1.5 時間」） */
  hours: {
    ja: ['所要 約 ', ' 時間'],
    en: ['About ', ' h'],
    zh: ['約 ', ' 小時'],
    ko: ['약 ', '시간'],
  } as Record<Lang, readonly [string, string]>,
  /** 到着地の時刻のラベル（楽しみの時刻に読ませない。spec-adversary m7） */
  destination: { ja: '到着地', en: 'At destination', zh: '抵達目的地', ko: '목적지 도착' } as L,
}
