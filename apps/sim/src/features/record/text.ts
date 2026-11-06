import type { Lang } from '@antler/schema'

// A-7 の sim の画面だけの文言（4 言語。docs/specs/result-screens/functional.md R3）。
// 記録の見出し・4 指標などの文言は api の SSR と同じ @antler/trip の recordText にある。祝いは sim の画面だけなのでここに置く。

type UiText = Record<Lang, string>

export const RECORD_CLEAR_TEXT = {
  clear: { ja: 'クリア', en: 'CLEAR', zh: '過關', ko: '클리어' },
  clearLead: {
    ja: 'D{n} を、鹿にぶつからずに走りきりました。',
    en: 'You drove Day {n} without hitting a deer.',
    zh: '第 {n} 天全程沒有撞到鹿，順利跑完。',
    ko: '{n}일차를 사슴과 부딪히지 않고 완주했습니다.',
  },
} satisfies Record<string, UiText>

export function clearLead(lang: Lang, day: number): string {
  return RECORD_CLEAR_TEXT.clearLead[lang].replace('{n}', String(day))
}
