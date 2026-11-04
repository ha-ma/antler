import { placeById } from '@antler/trip'
import { briefHref } from '../hooks/use-drive-params'
import type { DriveScenario } from '../types'
import { HUD_TEXT, SURFACE_TEXT, WEATHER_TEXT } from './hud/hud-text'

/** 地点の名前（マスターに無ければ slug のまま） */
function placeName(slug: string): string {
  return placeById(slug)?.name.ja ?? slug
}

/**
 * 出発の前の案内（drive-3d UC-7e、drive-link R7）。「出発」の操作の中で音を解除する（ブラウザの自動再生の制限）。
 * 旅の場面ではタイトル・日・区間・距離・条件と、A-2 へ戻るリンク
 */
export function StartOverlay({
  scenario,
  onStart,
}: {
  scenario: DriveScenario
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
        <p>{t.lead}</p>
      )}
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
          <a
            className="drive-start__link"
            href={briefHref(scenario.trip.id, scenario.day, scenario.alertEnabled)}
          >
            {HUD_TEXT.trip.toBrief}
          </a>
        )}
      </div>
    </section>
  )
}
