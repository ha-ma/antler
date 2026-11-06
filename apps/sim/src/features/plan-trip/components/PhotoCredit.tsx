import { usePlanTripStore } from '../store'
import { PLAN_TEXT, fillText } from '../text'
import type { PleasurePhoto } from '../utils/photos'

type Props = { photo: PleasurePhoto; name: string }

/**
 * 写真の引用（plan-trip-photos R7）。「写真: 撮影者 / ライセンス」。撮影者は出典ページへ、ライセンス名は
 * ライセンス本文へ、新しいタブでリンクする。撮影者とライセンス名は訳さない。トグルのボタンの外に置く。
 */
export function PhotoCredit({ photo, name }: Props) {
  const lang = usePlanTripStore((s) => s.lang)
  return (
    <p className="plan-card__credit">
      {PLAN_TEXT.photoCredit[lang]}:{' '}
      <a
        href={photo.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={fillText('photoSourceLabel', lang, {
          name,
          title: photo.title,
          author: photo.author,
        })}
      >
        {photo.author}
      </a>
      {' / '}
      {photo.licenseUrl ? (
        <a
          href={photo.licenseUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={fillText('photoLicenseLabel', lang, { name, license: photo.license })}
        >
          {photo.license}
        </a>
      ) : (
        <span>{photo.license}</span>
      )}
    </p>
  )
}
