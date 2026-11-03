import { formatKm } from '@antler/alert-ui'
import { formatJstTime } from '../../domain/clock'
import type { DriveSnapshot } from '../../domain/engine'
import { HUD_TEXT } from './hud-text'
import { StateMark } from './StateMark'

/** 左上のゾーン状態（R11、UC-7d）。アラート OFF でも琥珀は出す（A5-4） */
export function ZoneStatusPanel({ snapshot }: { snapshot: DriveSnapshot }) {
  const { alert, zone } = snapshot
  const t = HUD_TEXT.zone
  let body: string
  if (alert.state === 'danger') {
    body = t.danger
  } else if (zone.gps.status === 'inside') {
    body = `${t.inZone} ${formatKm(zone.gps.remainingKm)} km`
  } else if (zone.gps.distanceKm === undefined) {
    body = t.noNextZone
  } else {
    const eta = snapshot.nextZoneEtaMs === null ? '--:--' : formatJstTime(snapshot.nextZoneEtaMs)
    body = `${t.nextZone} ${formatKm(zone.gps.distanceKm)} km・${t.arrival} ${eta}`
  }
  return (
    <div className="drive-hud__zone" data-state={alert.state} data-testid="zone-status">
      <StateMark state={alert.state} size={28} />
      <span>{body}</span>
    </div>
  )
}
