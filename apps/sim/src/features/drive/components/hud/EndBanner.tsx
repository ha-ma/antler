import type { DriveOutcome } from '../../types'
import { HUD_TEXT } from './hud-text'

type Props = {
  outcome: DriveOutcome
  onRetry: () => void
  /** 旅の場面ならその日の A-2 へのリンク（drive-link R8） */
  briefHref?: string | undefined
}

/** 衝突・完走の帯（drive-3d R8、UC-8a・UC-8b）。A-6・A-7 の画面は後の feature */
export function EndBanner({ outcome, onRetry, briefHref }: Props) {
  if (outcome === 'driving') return null
  const t = HUD_TEXT.end
  const collided = outcome === 'collided'
  return (
    <section className="drive-hud__end" data-outcome={outcome} aria-labelledby="drive-end-title">
      <h2 id="drive-end-title">{collided ? t.collided : t.completed}</h2>
      <p>{collided ? t.collidedNote : t.completedNote}</p>
      <div className="drive-start__actions">
        <button type="button" className="drive-hud__primary" onClick={onRetry}>
          {t.retry}
        </button>
        {briefHref && (
          <a className="drive-start__link" href={briefHref}>
            {HUD_TEXT.trip.toBrief}
          </a>
        )}
      </div>
    </section>
  )
}
