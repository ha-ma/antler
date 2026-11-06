import { placeById } from '@antler/trip'
import { Link } from 'react-router'
import { briefHref } from '../hooks/use-drive-params'
import type { DriveScenario } from '../types'
import { HUD_TEXT, SURFACE_TEXT, WEATHER_TEXT } from './hud/hud-text'
import { MOBILE_TEXT } from './mobile-text'
import { SeasonSwitch } from './SeasonSwitch'

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
  noZone = false,
  touch = false,
  gyro,
  onStart,
}: {
  scenario: DriveScenario
  /** その日のルートに鹿ゾーンが無い（「出発」ですぐにその日の旅程をクリア。drive-tune UC-1e） */
  noZone?: boolean
  /** 主のポインタが指の端末（操作の説明を円とスマホの向きにする。mobile-landscape R3） */
  touch?: boolean
  /** 指で操る端末のジャイロの視線の切り替え（WCAG 2.5.4。無ければ出さない。mobile-landscape R4） */
  gyro?: { on: boolean; onToggle: (on: boolean) => void } | undefined
  onStart: () => void
}) {
  const t = HUD_TEXT.start
  const trip = scenario.source === 'trip'
  const m = MOBILE_TEXT[scenario.trip.lang]
  const touchHints = [...m.hints, gyro?.on ? m.lookGyro : m.lookDrag]
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
      <dl className="drive-hud__controls" data-testid="start-controls">
        {(touch ? touchHints : HUD_TEXT.controls).map(([key, label]) => (
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
        {/* 「出発」の行に置く（低い画面で行ごと下に留まり、スクロールしなくても見える） */}
        {gyro && (
          <button
            type="button"
            className="drive-hud__button drive-start__toggle"
            aria-pressed={gyro.on}
            onClick={() => gyro.onToggle(!gyro.on)}
          >
            {m.gyro}
          </button>
        )}
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
