import type { Pleasure } from '@antler/trip'
import { usePlanTripStore } from '../store'
import { fillText } from '../text'
import { hoursLabel } from '../utils/hours'
import { photoOf, photoSrc } from '../utils/photos'
import { PhotoCredit } from './PhotoCredit'
import { SelectBadge } from './SelectBadge'

/** 上限に達したときのメッセージの id（PleasurePicker が出す）。 */
export const LIMIT_MESSAGE_ID = 'plan-limit-message'

type Props = {
  pleasure: Pleasure
  selected: boolean
  /** 10 件選択済みで、これが未選択のとき（選べない。フォーカスは残し、理由を読み上げる） */
  locked: boolean
}

/**
 * 楽しみのカード（A1-2）。写真（無ければ photo-placeholder の面）、名前、補足、所要の目安。
 * 選択で spruce の枠とチェック。重さは設定させない（plan-trip-photos）。写真の引用はボタンの外。
 */
export function PleasureCard({ pleasure, selected, locked }: Props) {
  const lang = usePlanTripStore((s) => s.lang)
  const togglePleasure = usePlanTripStore((s) => s.togglePleasure)
  const name = pleasure.name[lang]
  const noteId = `plan-note-${pleasure.id}`
  const photo = photoOf(pleasure.id)

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
        {/* 写真は飾り（名前がボタンの名前になる）。引用は下の PhotoCredit */}
        <span
          className={photo ? 'plan-card__photo plan-card__photo--image' : 'plan-card__photo'}
          aria-hidden="true"
        >
          {photo ? (
            <img
              className="plan-card__img"
              src={photoSrc(photo)}
              alt=""
              width={photo.width}
              height={photo.height}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <span className="plan-card__photo-text">{fillText('photo', lang, { name })}</span>
          )}
          <SelectBadge selected={selected} />
        </span>
        <span className="plan-card__name">{name}</span>
      </button>
      <span id={noteId} className="plan-card__note">
        {pleasure.note[lang]}
        <span className="plan-card__hours">
          {fillText('hours', lang, { n: hoursLabel(pleasure.hours) })}
        </span>
      </span>
      {photo ? <PhotoCredit photo={photo} name={name} /> : null}
    </article>
  )
}
