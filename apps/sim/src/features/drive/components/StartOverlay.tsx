import { placeById } from '@antler/trip'
import { Link, useLocation } from 'react-router'
import { currentDemoSeason, DEMO_SEASONS, demoSeasonHref } from '../domain/demo-season'
import { briefHref } from '../hooks/use-drive-params'
import type { DriveScenario } from '../types'
import { HUD_TEXT, SURFACE_TEXT, WEATHER_TEXT } from './hud/hud-text'
import { SEASON_TEXT } from './season-text'

/** 地点の名前（マスターに無ければ slug のまま） */
function placeName(slug: string): string {
  return placeById(slug)?.name.ja ?? slug
}

/**
 * 見本の場面の季節の切り替え（drive-season R2）。運転の場面（engine）は読み込みのときに URL から作るので、
 * SPA の遷移ではなくページを読み直すふつうのリンクにする
 */
function SeasonSwitch() {
  const { search } = useLocation()
  const current = currentDemoSeason(search)
  return (
    <nav className="drive-start__seasons" aria-label={SEASON_TEXT.label}>
      <ul>
        {DEMO_SEASONS.map(({ id }) => (
          <li key={id}>
            <a href={demoSeasonHref(search, id)} aria-current={id === current ? 'true' : undefined}>
              {SEASON_TEXT.items[id]}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/**
 * 出発の前の案内（drive-3d UC-7e、drive-link R7）。「出発」の操作の中で音を解除する（ブラウザの自動再生の制限）。
 * 旅の場面ではタイトル・日・区間・距離・条件と、A-2 へ戻るリンク
 */
export function StartOverlay({
  scenario,
  noZone = false,
  onStart,
}: {
  scenario: DriveScenario
  /** その日のルートに鹿ゾーンが無い（「出発」ですぐにその日の旅程をクリア。drive-tune UC-1e） */
  noZone?: boolean
  onStart: () => void
}) {
  const t = HUD_TEXT.start
  const trip = scenario.source === 'trip'
  return (
    <section className="drive-start" aria-labelledby="drive-start-title">
      <h1 id="drive-start-title">{trip ? scenario.trip.title : t.title}</h1>
      {trip ? (
        <p data-testid="start-leg">
          D{scenario.day} {placeName(scenario.from)} → {placeName(scenario.to)}・
          {HUD_TEXT.trip.distance}{' '}
          <span className="drive-hud__num">{Math.round(scenario.distanceKm)}</span> km・
          {WEATHER_TEXT[scenario.weather]}・{SURFACE_TEXT[scenario.surface]}
        </p>
      ) : (
        <>
          <p>{t.lead}</p>
          <p data-testid="start-conditions">
            {WEATHER_TEXT[scenario.weather]}・{SURFACE_TEXT[scenario.surface]}
          </p>
          <SeasonSwitch />
        </>
      )}
      {noZone && <p data-testid="no-zone">{HUD_TEXT.stage.noZone}</p>}
      <p>{scenario.alertEnabled ? t.alertOn : t.alertOff}</p>
      <dl className="drive-hud__controls">
        {HUD_TEXT.controls.map(([key, label]) => (
          <div key={key}>
            <dt>
              <kbd>{key}</kbd>
            </dt>
            <dd>{label}</dd>
          </div>
        ))}
      </dl>
      <div className="drive-start__actions">
        <button type="button" className="drive-hud__primary" onClick={onStart}>
          {t.go}
        </button>
        {trip && (
          <Link
            className="drive-start__link"
            to={briefHref(scenario.trip.id, scenario.day, scenario.alertEnabled)}
          >
            {HUD_TEXT.trip.toBrief}
          </Link>
        )}
      </div>
    </section>
  )
}
