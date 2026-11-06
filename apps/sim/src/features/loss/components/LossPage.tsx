import type { Lang } from '@antler/schema'
import { formatBudget } from '@antler/trip'
import { Link } from 'react-router'
import { recordHref } from '@/features/record'
import { browserLang } from '@/shared/utils/browser-lang'
import baseline from '../data/loss-baseline.json'
import { assessLoss } from '../domain/assess-loss'
import { strikeItinerary } from '../domain/strike'
import { useCollision } from '../hooks/useCollision'
import { LossTripDayError, useLossTripDay } from '../hooks/useLossTripDay'
import { spotLine } from '../spot-text'
import { fillText, LOSS_TEXT } from '../text'
import type { LossBaseline, ResolvedCollision, TripDay } from '../types'
import { checkAgainstDay, resolveCollision } from '../utils/collision-url'
import { clockOf, factSentence, placeName } from '../utils/format'
import { replayHref, retryHref } from '../utils/links'
import { LossCard } from './LossCard'
import { StatTile } from './StatTile'
import { StatsCard } from './StatsCard'
import { StoryPanel } from './StoryPanel'
import './loss.css'

const BASELINE: LossBaseline = baseline

/** 遷移してきたら見出しにフォーカスを移す（ref のコールバック。useEffect を使わない） */
function focusOnMount(el: HTMLHeadingElement | null): void {
  el?.focus()
}

const htmlLang = (lang: Lang) => (lang === 'zh' ? 'zh-Hant' : lang)

/**
 * `/loss/:id?…` — A-6 喪失（docs/specs/loss/functional.md R1〜R5・R9・R10）。night テーマ。
 * URL が読めない → api を呼ばない。しおりを読んでから R7 と同じ規則で確かめ、通ったら喪失文を頼む。
 */
export function LossPage() {
  const collision = useCollision()
  const query = useLossTripDay(collision?.tripId ?? '', collision?.day ?? 0, collision !== null)

  // 旅が読めるまでは言語が分からない。A-1 と同じくブラウザの言語で出す（i18n R5・S-1）
  const fallback = browserLang()
  if (collision === null) return <LossStatus kind="unreadable" lang={fallback} />
  if (query.isPending) {
    return (
      <main className="loss loss--status" data-theme="night" lang={htmlLang(fallback)}>
        <title>{`${LOSS_TEXT.loadingTrip[fallback]} | ${LOSS_TEXT.brand[fallback]}`}</title>
        <p role="status">{LOSS_TEXT.loadingTrip[fallback]}</p>
      </main>
    )
  }
  if (query.isError) {
    const e = query.error instanceof LossTripDayError ? query.error : null
    if (e?.code === 'DAY_NOT_FOUND') return <LossStatus kind="unreadable" lang={fallback} />
    if (e?.status === 404) return <LossStatus kind="notFound" lang={fallback} />
    if (e?.status === 409) return <LossStatus kind="outdated" lang={fallback} />
    return <LossStatus kind="tripFailed" lang={fallback} onRetry={() => void query.refetch()} />
  }
  const { plan, day } = query.data
  // 済ませた楽しみが URL に無い（DriveResult から来た）ときは、しおりから「予定どおり」を決める
  const resolved = resolveCollision(collision, day)
  if (!checkAgainstDay(plan, day, resolved))
    return <LossStatus kind="unreadable" lang={plan.lang} />
  return <LossContent data={query.data} collision={resolved} />
}

type StatusKind = 'unreadable' | 'notFound' | 'outdated' | 'tripFailed'

function LossStatus({
  kind,
  lang,
  onRetry,
}: {
  kind: StatusKind
  lang: Lang
  onRetry?: () => void
}) {
  const t = LOSS_TEXT
  const message = t[kind][lang]
  return (
    <main className="loss loss--status" data-theme="night" lang={htmlLang(lang)}>
      <title>{`${message} | ${t.brand[lang]}`}</title>
      <h1 className="loss-status__title" tabIndex={-1} ref={focusOnMount}>
        {message}
      </h1>
      {onRetry ? (
        <button type="button" className="loss-button loss-button--secondary" onClick={onRetry}>
          {t.retry[lang]}
        </button>
      ) : (
        <Link className="loss-button loss-button--secondary" to="/plan">
          {t.toPlan[lang]}
        </Link>
      )}
    </main>
  )
}

function LossContent({ data, collision }: { data: TripDay; collision: ResolvedCollision }) {
  const { plan, details, day } = data
  const lang = plan.lang
  const t = LOSS_TEXT
  const leg = day.legs[collision.leg]
  const rows = strikeItinerary(plan, day, collision)
  const loss = assessLoss(plan, collision, BASELINE)
  const spotText = spotLine(collision.spotting, lang)
  const eyebrow = fillText(t.eyebrow[lang], {
    n: collision.day,
    time: clockOf(collision.at),
    from: placeName(leg?.from ?? '', lang),
    to: placeName(leg?.to ?? '', lang),
  })

  return (
    <div className="loss" data-theme="night" lang={htmlLang(lang)}>
      <title>{`${t.pageTitle[lang]} | ${t.brand[lang]}`}</title>
      <main className="loss-body">
        <section className="loss-main" aria-labelledby="loss-heading">
          <div className="loss-intro">
            <p className="loss-eyebrow">{eyebrow}</p>
            <h1 id="loss-heading" className="loss-title" tabIndex={-1} ref={focusOnMount}>
              {t.heading[lang]}
            </h1>
            <p className="loss-fact">{factSentence(collision, lang)}</p>
            {/* 鹿の発見の 1 行（drive-crash-spot R4。並べ方は result-screens に任せる） */}
            {spotText && (
              <p className="loss-fact" data-testid="loss-spotting">
                {spotText}
              </p>
            )}
          </div>
          <StoryPanel collision={collision} lang={lang} />
          <section aria-labelledby="loss-metrics-heading">
            <h2 id="loss-metrics-heading" className="loss-visually-hidden">
              {t.metrics[lang]}
            </h2>
            <dl className="loss-tiles">
              <StatTile
                label={t.tileVehicle[lang]}
                value={formatBudget(loss.vehicle.averageJPY, lang)}
                tone="clay"
                note={fillText(t.tileVehicleNote[lang], {
                  max: formatBudget(loss.vehicle.maxJPY, lang),
                })}
              />
              <StatTile
                label={t.tileCancel[lang]}
                value={formatBudget(loss.cancel.jpy, lang)}
                tone="clay"
                note={
                  <>
                    {fillText(t.tileCancelNote[lang], {
                      nights: loss.cancel.nights,
                      pleasures: loss.cancel.lostPleasures,
                      people: loss.cancel.people,
                    })}
                    {loss.cancel.approximate ? (
                      <span className="loss-tile__approx">{t.approx[lang]}</span>
                    ) : null}
                  </>
                }
              />
              <StatTile
                label={t.tileDays[lang]}
                value={
                  <>
                    {loss.days.lost}
                    <span className="loss-tile__unit"> {t.unitDays[lang]}</span>
                  </>
                }
                note={fillText(t.daysNote[lang], { from: loss.days.fromDay, to: loss.days.toDay })}
              />
              <StatTile
                label={fillText(t.tilePleasures[lang], { total: loss.pleasures.total })}
                value={`${String(loss.pleasures.achieved)} / ${String(loss.pleasures.total)}`}
                note={fillText(t.pleasuresNote[lang], {
                  achieved: loss.pleasures.achievedWeight,
                  total: loss.pleasures.totalWeight,
                })}
              />
            </dl>
          </section>
          <nav className="loss-actions" aria-label={t.actions[lang]}>
            <Link className="loss-button loss-button--primary" to={retryHref(collision)}>
              {collision.alertEnabled ? t.primaryOn[lang] : t.primaryOff[lang]}
            </Link>
            <div className="loss-actions__sub">
              <Link className="loss-button loss-button--secondary" to={replayHref(collision)}>
                {t.replay[lang]}
              </Link>
              <Link className="loss-button loss-button--secondary" to="/plan">
                {t.newTrip[lang]}
              </Link>
            </div>
            {/* A-7 の旅の記録（record）。その日は衝突として残る。A6-4 の 3 つより控えめに */}
            <Link className="loss-record-link" to={recordHref(collision.tripId)}>
              {t.toRecord[lang]}
            </Link>
          </nav>
        </section>
        <aside className="loss-aside">
          <LossCard
            lang={lang}
            title={details.titles[lang]}
            dayCount={plan.days.length}
            rows={rows}
          />
          <StatsCard lang={lang} />
        </aside>
      </main>
    </div>
  )
}
