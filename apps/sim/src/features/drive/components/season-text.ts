import type { Lang } from '@antler/schema'
import type { DEMO_SEASONS } from '../domain/demo-season'

// 出発の案内の季節の切り替えの文言（drive-season R2・R5）。4 言語（docs/specs/i18n/functional.md R5）

type SeasonText = {
  label: string
  items: Record<(typeof DEMO_SEASONS)[number]['id'], string>
}

export const SEASON_TEXT: Record<Lang, SeasonText> = {
  ja: {
    label: '季節',
    items: {
      default: '既定（2 月・薄暮）',
      winter: '冬・雪（2 月）',
      frozen: '冬・晴れ（2 月）',
      thaw: '雪どけ・雨（4 月）',
      summer: '夏・晴れ（7 月）',
      autumn: '秋・雨（10 月）',
    },
  },
  en: {
    label: 'Season',
    items: {
      default: 'Default (February, dusk)',
      winter: 'Winter, snow (February)',
      frozen: 'Winter, clear (February)',
      thaw: 'Snowmelt, rain (April)',
      summer: 'Summer, clear (July)',
      autumn: 'Autumn, rain (October)',
    },
  },
  zh: {
    label: '季節',
    items: {
      default: '預設（2 月・黃昏）',
      winter: '冬・下雪（2 月）',
      frozen: '冬・晴（2 月）',
      thaw: '融雪・下雨（4 月）',
      summer: '夏・晴（7 月）',
      autumn: '秋・下雨（10 月）',
    },
  },
  ko: {
    label: '계절',
    items: {
      default: '기본 (2월·해 질 녘)',
      winter: '겨울·눈 (2월)',
      frozen: '겨울·맑음 (2월)',
      thaw: '해빙기·비 (4월)',
      summer: '여름·맑음 (7월)',
      autumn: '가을·비 (10월)',
    },
  },
}
