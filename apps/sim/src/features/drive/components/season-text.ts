import type { DEMO_SEASONS } from '../domain/demo-season'

// 出発の案内の季節の切り替えの文言（drive-season R2・R5。HUD の他の文言と同じく日本語のみ）

export const SEASON_TEXT: {
  label: string
  items: Record<(typeof DEMO_SEASONS)[number]['id'], string>
} = {
  label: '季節',
  items: {
    default: '既定（2 月・薄暮）',
    winter: '冬・雪（2 月）',
    thaw: '雪どけ・雨（4 月）',
    summer: '夏・晴れ（7 月）',
    autumn: '秋・雨（10 月）',
  },
}
