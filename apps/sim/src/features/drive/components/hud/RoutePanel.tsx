import { formatKm } from '@antler/alert-ui'
import { placeById, pleasureById } from '@antler/trip'
import { formatJstTime } from '../../domain/clock'
import type { DriveSnapshot } from '../../domain/engine'
import type { DriveScenario } from '../../types'
import { HUD_TEXT } from './hud-text'

/**
 * いまの区間の案内（drive-tune R4、UC-4a）。HUD の左（ゾーン状態の下）に、その日の区間・目的地までの km と到着予定・
 * ステージ・その日の楽しみの名前と一言。右側は車内の会話の表示のために空けておく
 */
export function RoutePanel({
  scenario,
  snapshot,
}: {
  scenario: DriveScenario
  snapshot: DriveSnapshot
}) {
  const t = HUD_TEXT.route
  const from = placeById(scenario.from)?.name.ja ?? scenario.from
  const to = placeById(scenario.to)?.name.ja ?? scenario.to
  const pleasures = scenario.stops.flatMap((id) => {
    const p = pleasureById(id)
    return p ? [{ id, name: p.name.ja, note: p.note.ja }] : []
  })
  const { stage, destination } = snapshot
  return (
    <section className="drive-hud__route" aria-label={t.label} data-testid="route-panel">
      <p className="drive-hud__route-leg">
        D{scenario.day} {from} → {to}
      </p>
      <p>
        {t.destination} <span className="drive-hud__num">{formatKm(destination.km)}</span> km・
        {t.arrival} <span className="drive-hud__num">{formatJstTime(destination.etaMs)}</span>
      </p>
      {stage.count > 0 && (
        <p>
          {t.stage} <span className="drive-hud__num">{stage.index}</span> /{' '}
          <span className="drive-hud__num">{stage.count}</span>
        </p>
      )}
      {pleasures.length > 0 && (
        <>
          <h2 className="drive-hud__route-title">{t.today}</h2>
          <ul className="drive-hud__route-list">
            {pleasures.map((p) => (
              <li key={p.id}>
                <span className="drive-hud__route-name">{p.name}</span>
                <span className="drive-hud__route-note">{p.note}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
