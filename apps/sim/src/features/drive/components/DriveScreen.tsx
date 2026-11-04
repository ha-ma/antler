import { useMemo, type ComponentProps } from 'react'
import { TripDayError } from '../api/trip-day'
import { DriveEngine } from '../domain/engine'
import { demoScenario } from '../domain/scenario'
import { scenarioFromDay } from '../domain/trip-scenario'
import { ZONES } from '../domain/zones-data'
import { briefHref, useDriveParams, type DriveParams } from '../hooks/use-drive-params'
import { useTripDay } from '../hooks/use-trip-day'
import { DrivePage } from './DrivePage'
import { HUD_TEXT } from './hud/hud-text'
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
        createEngine={() => new DriveEngine(demoScenario(ZONES, search), ZONES)}
        {...page}
      />
    )
  }
  if (params.kind === 'bad-trip') {
    return <TripMessage text={HUD_TEXT.trip.notFound} links={[['/plan', HUD_TEXT.trip.toPlan]]} />
  }
  // 旅・日・アラートが変わったら作り直す（エンジンは最初の 1 回だけ作るので）
  return (
    <TripDrive
      key={`${params.id}/${String(params.day)}/${params.search}`}
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
  const t = HUD_TEXT.trip
  const brief = briefHref(params.id, params.day, params.alertOn)

  if (query.isPending) return <TripMessage text={t.loading} busy />
  if (query.isError) {
    const error = query.error
    const code = error instanceof TripDayError ? error.code : null
    if (code === 'TRIP_NOT_FOUND')
      return <TripMessage text={t.notFound} links={[['/plan', t.toPlan]]} />
    if (code === 'DAY_NOT_FOUND') {
      return (
        <TripMessage
          text={t.dayNotFound}
          links={[[briefHref(params.id, 1, params.alertOn), t.toFirstDay]]}
        />
      )
    }
    if (code === 'ITINERARY_CHANGED') {
      return <TripMessage text={t.changed} links={[['/plan', t.toPlan]]} />
    }
    const text = code === 'RATE_LIMITED' ? t.rateLimited : t.failed
    return (
      <TripMessage text={text} onRetry={() => void query.refetch()} links={[[brief, t.toBrief]]} />
    )
  }
  if (!scenario) {
    return <TripMessage text={t.noMove} links={[[brief, t.toBrief]]} />
  }
  return <DrivePage createEngine={() => new DriveEngine(scenario, ZONES)} {...page} />
}

/** 読み込み中・失敗の案内（R2） */
function TripMessage({
  text,
  links = [],
  onRetry,
  busy = false,
}: {
  text: string
  links?: [href: string, label: string][]
  onRetry?: () => void
  busy?: boolean
}) {
  return (
    <main className="drive" data-theme="night">
      <section className="drive-start" aria-busy={busy}>
        <p role={busy ? 'status' : 'alert'} data-testid="drive-message">
          {text}
        </p>
        <div className="drive-start__actions">
          {onRetry && (
            <button type="button" className="drive-hud__primary" onClick={onRetry}>
              {HUD_TEXT.trip.retry}
            </button>
          )}
          {links.map(([href, label]) => (
            <a key={href} className="drive-start__link" href={href}>
              {label}
            </a>
          ))}
        </div>
      </section>
    </main>
  )
}
