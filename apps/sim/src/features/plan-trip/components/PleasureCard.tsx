import type { Pleasure } from '@antler/trip'
import { usePlanTripStore } from '../store'
import { fillText } from '../text'
import { SelectBadge } from './SelectBadge'
import { WeightPicker } from './WeightPicker'

/** 上限に達したときのメッセージの id（PleasurePicker が出す）。 */
export const LIMIT_MESSAGE_ID = 'plan-limit-message'

type Props = {
  pleasure: Pleasure
  /** 選択済みなら重さ（1〜5）、未選択は null */
  weight: number | null
  /** 10 件選択済みで、これが未選択のとき（選べない。フォーカスは残し、理由を読み上げる） */
  locked: boolean
}

/** 楽しみのカード（A1-2）。写真は photo-placeholder の面。選択で spruce の枠とチェック、重さ 1〜5。 */
export function PleasureCard({ pleasure, weight, locked }: Props) {
  const lang = usePlanTripStore((s) => s.lang)
  const togglePleasure = usePlanTripStore((s) => s.togglePleasure)
  const selected = weight !== null
  const name = pleasure.name[lang]
  const noteId = `plan-note-${pleasure.id}`

  return (
    <article className={selected ? 'plan-card plan-card--selected' : 'plan-card'}>
      <button
        type="button"
        className="plan-card__toggle"
        aria-pressed={selected}
        aria-disabled={locked || undefined}
        aria-describedby={locked ? `${noteId} ${LIMIT_MESSAGE_ID}` : noteId}
        onClick={() => {
          if (!locked) togglePleasure(pleasure.id)
        }}
      >
        <span className="plan-card__photo" aria-hidden="true">
          <span className="plan-card__photo-text">{fillText('photo', lang, { name })}</span>
          <SelectBadge selected={selected} />
        </span>
        <span className="plan-card__name">{name}</span>
      </button>
      <span id={noteId} className="plan-card__note">
        {pleasure.note[lang]}
      </span>
      {selected ? <WeightPicker pleasureId={pleasure.id} name={name} weight={weight} /> : null}
    </article>
  )
}
