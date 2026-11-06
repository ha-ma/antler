import type { Lang } from '@antler/schema'
import { useMemo, type ComponentProps } from 'react'
import { Link } from 'react-router'
import { browserLang, browserLangs } from '@/shared/utils/browser-lang'
import { TripDayError } from '../api/trip-day'
import { htmlLang } from '../chat/ChatFeed'
import { DriveEngine } from '../domain/engine'
import { demoScenario } from '../domain/scenario'
import { scenarioFromDay } from '../domain/trip-scenario'
import { ZONES } from '../domain/zones-data'
import { briefHref, useDriveParams, type DriveParams } from '../hooks/use-drive-params'
import { useTripDay } from '../hooks/use-trip-day'
import { DrivePage } from './DrivePage'
import { hudText } from './hud/hud-text'
import '@antler/alert-ui/tokens.css'
import './drive.css'

// /drive の入口（drive-link R1・R2）。URL の trip が無ければ見本の場面、あればその旅のその日を API から読んで走る。

type PageProps = ComponentProps<typeof DrivePage>

type Props = {
  /** 衝突・完走したときに走行の結果を渡す（A-6・A-7 が使う） */
  onFinish?: PageProps['onFinish']
  /** テストで差し替える（jsdom には WebGL が無い）。DrivePage にそのまま渡す */
  canvas?: PageProps['canvas']
  webgl2?: PageProps['webgl2']
}

export function DriveScreen({ onFinish, canvas, webgl2 }: Props) {
  const params = useDriveParams()
  const page = { onFinish, canvas, webgl2 }
  if (params.kind === 'demo') {
    const search = params.search
    return (
      <DrivePage
        createEngine={() => new DriveEngine(demoScenario(ZONES, search, browserLangs()), ZONES)}
        {...page}
      />
    )
  }
  if (params.kind === 'bad-trip') {
    const lang = browserLang()
    const t = hudText(lang).trip
    return <TripMessage lang={lang} text={t.notFound} links={[['/plan', t.toPlan]]} />
  }
  // 旅・日・アラートが変わったら作り直す（エンジンは最初の 1 回だけ作るので）
  return (
    <TripDrive
      key={`${params.id}/${String(params.day)}/${params.alertOn ? 'on' : 'off'}`}
      params={params}
      page={page}
    />
  )
}

function TripDrive({
  params,
  page,
}: {
  params: Extract<DriveParams, { kind: 'trip' }>
  page: Omit<PageProps, 'createEngine'>
}) {
  const query = useTripDay(params.id, params.day)
  const scenario = useMemo(
    () => (query.data ? scenarioFromDay(query.data, params.search) : undefined),
    [query.data, params.search],
  )
  // 旅を読めるまではブラウザの言語、読めたら旅の言語（i18n R5）
  const lang = query.data?.plan.lang ?? browserLang()
  const t = hudText(lang).trip
  const brief = briefHref(params.id, params.day, params.alertOn)

  if (query.isPending) return <TripMessage lang={lang} text={t.loading} busy />
  if (query.isError) {
    const error = query.error
    const code = error instanceof TripDayError ? error.code : null
    if (code === 'TRIP_NOT_FOUND')
      return <TripMessage lang={lang} text={t.notFound} links={[['/plan', t.toPlan]]} />
    if (code === 'DAY_NOT_FOUND') {
      return (
        <TripMessage
          lang={lang}
          text={t.dayNotFound}
          links={[[briefHref(params.id, 1, params.alertOn), t.toFirstDay]]}
        />
      )
    }
    if (code === 'ITINERARY_CHANGED') {
      return <TripMessage lang={lang} text={t.changed} links={[['/plan', t.toPlan]]} />
    }
    const text = code === 'RATE_LIMITED' ? t.rateLimited : t.failed
    return (
      <TripMessage
        lang={lang}
        text={text}
        onRetry={() => void query.refetch()}
        links={[[brief, t.toBrief]]}
      />
    )
  }
  if (!scenario) {
    return <TripMessage lang={lang} text={t.noMove} links={[[brief, t.toBrief]]} />
  }
  return <DrivePage createEngine={() => new DriveEngine(scenario, ZONES)} {...page} />
}

/** 読み込み中・失敗の案内（R2） */
function TripMessage({
  lang,
  text,
  links = [],
  onRetry,
  busy = false,
}: {
  lang: Lang
  text: string
  links?: [href: string, label: string][]
  onRetry?: () => void
  busy?: boolean
}) {
  return (
    <main className="drive" data-theme="night" lang={htmlLang(lang)}>
      <section className="drive-start" aria-busy={busy}>
        <p role={busy ? 'status' : 'alert'} data-testid="drive-message">
          {text}
        </p>
        <div className="drive-start__actions">
          {onRetry && (
            <button type="button" className="drive-hud__primary" onClick={onRetry}>
              {hudText(lang).trip.retry}
            </button>
          )}
          {links.map(([href, label]) => (
            <Link key={href} className="drive-start__link" to={href}>
              {label}
            </Link>
          ))}
        </div>
      </section>
    </main>
  )
}
