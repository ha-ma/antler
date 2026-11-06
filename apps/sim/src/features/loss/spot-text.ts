import type { Lang } from '@antler/schema'
import type { LossSpotting } from './types'

// A-6 の鹿の発見の 1 行（drive-crash-spot R4）。並べ方・見た目は result-screens に任せる（1 行だけ足す）。
// zh は繁體字（i18n R1）。A-7 の行（packages/trip の record/text.ts の spotting）と同じ文。60 m は drive の SPOT_EARLY_M。

const SPOT_LINE: Record<Lang, string> = {
  ja: '自分で見つけた鹿 {found} / {appeared} 頭（60 m より前で {early} 頭）',
  en: 'Deer you spotted: {found} / {appeared} ({early} more than 60 m ahead)',
  zh: '自己發現的鹿 {found} / {appeared} 頭（60 公尺以外 {early} 頭）',
  ko: '직접 발견한 사슴 {found} / {appeared}마리 (60 m 앞에서 {early}마리)',
}

/** 見えた鹿が 1 頭以上のときの 1 行。無ければ null（行を出さない） */
export function spotLine(spotting: LossSpotting | undefined, lang: Lang): string | null {
  if (!spotting || spotting.appeared === 0) return null
  return SPOT_LINE[lang]
    .replace('{found}', String(spotting.found))
    .replace('{appeared}', String(spotting.appeared))
    .replace('{early}', String(spotting.early))
}
