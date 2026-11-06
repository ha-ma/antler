import type { Lang } from '@antler/schema'
import { memo, useId, useSyncExternalStore } from 'react'
import { photoOf, photoSrc } from '@/features/plan-trip'
import { htmlLang } from '../../chat/ChatFeed'
import { PhotoCaption } from '../../chat/PhotoCaption'
import { formatJstTime } from '../../domain/clock'
import type { DriveEngine } from '../../domain/engine'
import { useRecommendation } from '../../hooks/use-recommendation'
import { cardNote } from './recommend'
import { RECOMMEND_TEXT } from './recommend-text'

/**
 * 鹿ゾーンの前のおすすめ（docs/specs/drive-tourism/functional.md T11〜T15）。右の列の下、音量の操作の上。
 * ゾーンの外で出し、ゾーンを出た後・赤の後は実時間 4 秒で出し直し、12 秒ごとに入れ替える
 * （出しどきは RecommendTracker。drive-sound-tourism S16・S17）。
 * 操作要素を置かない・フォーカスを取らない・ポインタを通す。読み上げの領域にしない（アラートの読み上げと重ねない）。
 * 到着地の時刻は、出ている間だけ自分で購読して読む（親の 10 Hz の描き直しに頼らない）
 */
export const RecommendCard = memo(function RecommendCard({
  engine,
  lang,
}: {
  engine: DriveEngine
  lang: Lang
}) {
  // 親（DrivePage）は約 10 Hz で描き直すので memo にし、出すものが変わったときだけ描き直す（component-guard W2）
  const pick = useRecommendation(engine)
  const titleId = useId()
  if (!pick) return null
  const { pleasure } = pick
  const photo = photoOf(pleasure.id)
  const note = cardNote(pleasure.note[lang])
  const [before, after] = RECOMMEND_TEXT.hours[lang]
  return (
    // 名前は見出し（eyebrow）を指す（同じ文を aria-label と本文で 2 回読ませない。code-reviewer I5）
    // 入れ替わったら作り直して、現れるときと同じふわっとをもう一度（drive-sound-tourism S19）
    <aside
      key={pleasure.id}
      className="drive-recommend"
      aria-labelledby={titleId}
      lang={htmlLang(lang)}
      data-testid="recommend-card"
    >
      {photo && (
        <img
          className="drive-recommend__photo"
          src={photoSrc(photo)}
          alt=""
          width={photo.width}
          height={photo.height}
          decoding="async"
        />
      )}
      <div className="drive-recommend__body">
        <p id={titleId} className="drive-recommend__eyebrow">
          {RECOMMEND_TEXT.title[lang]}
        </p>
        <h2 className="drive-recommend__name">{pleasure.name[lang]}</h2>
        {note && <p className="drive-recommend__note">{note}</p>}
        <p className="drive-recommend__meta">
          <span>
            {before}
            <span className="drive-hud__num">{String(pleasure.hours)}</span>
            {after}
          </span>
          {pick.atDestination && <DestinationTime engine={engine} lang={lang} />}
        </p>
        {photo && <PhotoCaption photo={photo} lang={lang} className="drive-recommend__credit" />}
      </div>
    </aside>
  )
})

/** 到着地の時刻（目的地の到着予定。分が変わったときだけ描き直す） */
function DestinationTime({ engine, lang }: { engine: DriveEngine; lang: Lang }) {
  const time = useSyncExternalStore(engine.subscribe, () =>
    formatJstTime(engine.getSnapshot().destination.etaMs),
  )
  return (
    <span>
      {RECOMMEND_TEXT.destination[lang]} <span className="drive-hud__num">{time}</span>
    </span>
  )
}
