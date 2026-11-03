import { Link, useLocation, useParams } from 'react-router'
import { usePlanTripStore } from '../store'
import { PLAN_TEXT } from '../text'
import { htmlLang, readBriefTitles } from '../utils/lang'
import './plan-trip.css'

/** 遷移してきたら見出しにフォーカスを移す（ref のコールバック。useEffect を使わない）。 */
function focusOnMount(el: HTMLHeadingElement | null): void {
  el?.focus()
}

/**
 * `/trip/:id/brief` の仮の画面。中身（地図・ゾーン通過の予定）は brief-map の feature が作る。
 * タイトルは作成の直後に遷移の state で受け取る（GET の API はまだ無い）。
 */
export function TripBriefPlaceholder() {
  const lang = usePlanTripStore((s) => s.lang)
  const { id } = useParams()
  const titles = readBriefTitles(useLocation().state)
  return (
    <main className="plan-brief" lang={htmlLang(lang)}>
      <title>{`${PLAN_TEXT.briefPending[lang]} | ${PLAN_TEXT.brand[lang]}`}</title>
      <h1 className="plan-title" tabIndex={-1} ref={focusOnMount}>
        {PLAN_TEXT.briefPending[lang]}
      </h1>
      {titles ? (
        <p className="plan-brief__title">
          <span className="plan-visually-hidden">{PLAN_TEXT.briefTitle[lang]}: </span>
          {titles[lang]}
        </p>
      ) : null}
      <p className="plan-num plan-fine">{id}</p>
      <Link to="/plan" className="plan-link">
        {PLAN_TEXT.briefBack[lang]}
      </Link>
    </main>
  )
}
