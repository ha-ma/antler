import type { Lang } from '@antler/schema'
import { Link } from 'react-router'
import type { DriveOutcome } from '../../types'
import { hudText } from './hud-text'

type Props = {
  outcome: DriveOutcome
  onRetry: () => void
  /** 旅の場面ならその日の A-2 へのリンク（drive-link R8） */
  briefHref?: string | undefined
  lang: Lang
}

/** 衝突・完走の帯（drive-3d R8、UC-8a・UC-8b）。旅の場面では、このあと A-6・A-7 に移る */
export function EndBanner({ outcome, onRetry, briefHref, lang }: Props) {
  if (outcome === 'driving') return null
  const hud = hudText(lang)
  const t = hud.end
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
          <Link className="drive-start__link" to={briefHref}>
            {hud.trip.toBrief}
          </Link>
        )}
      </div>
    </section>
  )
}
