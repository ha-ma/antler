import type { DriveOutcome } from '../../types'
import { HUD_TEXT } from './hud-text'

/** 衝突・完走の帯（R8、UC-8a・UC-8b）。A-6・A-7 の画面は後の feature */
export function EndBanner({ outcome, onRetry }: { outcome: DriveOutcome; onRetry: () => void }) {
  if (outcome === 'driving') return null
  const t = HUD_TEXT.end
  const collided = outcome === 'collided'
  return (
    <section className="drive-hud__end" data-outcome={outcome} aria-labelledby="drive-end-title">
      <h2 id="drive-end-title">{collided ? t.collided : t.completed}</h2>
      <p>{collided ? t.collidedNote : t.completedNote}</p>
      <button type="button" className="drive-hud__primary" onClick={onRetry}>
        {t.retry}
      </button>
    </section>
  )
}
