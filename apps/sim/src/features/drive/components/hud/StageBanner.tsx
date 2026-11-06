import type { DriveSnapshot } from '../../domain/engine'
import { HUD_TEXT } from './hud-text'

/** ステージをクリアしたあと 2 秒（シミュレーションの時計）出す帯（drive-tune R1）。その間も走れる */
export const STAGE_BANNER_MS = 2000

export function StageBanner({ snapshot }: { snapshot: DriveSnapshot }) {
  const { stageClearedAt, stage, t, outcome } = snapshot
  if (outcome !== 'driving' || stageClearedAt === null || t - stageClearedAt > STAGE_BANNER_MS) {
    return null
  }
  return (
    <p className="drive-hud__stage" role="status" data-testid="stage-banner">
      {HUD_TEXT.stage.cleared(stage.index - 1, stage.count)}
    </p>
  )
}
