import type { Lang } from '@antler/schema'
import type { Spotting } from '../../types'
import { spotCount } from '../spot-text'

/**
 * 鹿の発見の件数（drive-crash-spot R4・UC-4g）。左の列の小さな 1 行。輪・音は出さず、読み上げの割り込みもしない。
 * まだ見えた鹿が無ければ出さない
 */
export function SpotCount({ spotting, lang }: { spotting: Spotting; lang: Lang }) {
  if (spotting.appeared === 0) return null
  return (
    <p className="drive-hud__spot" data-testid="spot-count">
      {spotCount(lang, spotting)}
    </p>
  )
}
