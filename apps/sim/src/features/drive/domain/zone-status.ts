import { measureAlongRoute, type LonLat, type RoutePlan } from '@antler/zones'
import type { ZoneStatus } from '../types'

// ゾーン状態（R2）。車の緯度経度を measureAlongRoute にかけ、最初のフレームから inside / outside を決める。
// unknown は渡さない（deriveAlertState が起動直後扱いで琥珀にし、チャイムが鳴るため。roadmap の持ち越し C-1）。

/** 車の位置（緯度経度）と前回の道のり（km、往復の取り違え防止）からゾーン状態を出す */
export function zoneStatusAt(plan: RoutePlan, position: LonLat, hintKm?: number): ZoneStatus {
  const m = measureAlongRoute(plan, position, hintKm)
  const interval = m.current
    ? plan.intervals.findIndex((i) => i.entryKm <= m.positionKm && m.positionKm <= i.exitKm)
    : -1
  const nextEntryKm = m.next ? m.next.entryKm : null
  if (m.current) {
    return {
      gps: { status: 'inside', remainingKm: m.current.remainingKm },
      interval,
      nextEntryKm,
      positionKm: m.positionKm,
    }
  }
  return {
    gps: m.next ? { status: 'outside', distanceKm: m.next.distanceKm } : { status: 'outside' },
    interval: null,
    nextEntryKm,
    positionKm: m.positionKm,
  }
}

/** 道のり s（m）がいずれかの区間の中なら、その区間の番号 */
export function intervalAt(plan: RoutePlan, sM: number): number | null {
  const km = sM / 1000
  const i = plan.intervals.findIndex((v) => v.entryKm <= km && km <= v.exitKm)
  return i === -1 ? null : i
}

/** from（m）から to（m）へ進むあいだに最初に越える区間の入口（m）。越えなければ null */
export function firstEntryBetween(plan: RoutePlan, fromM: number, toM: number): number | null {
  if (toM <= fromM) return null
  for (const v of plan.intervals) {
    const entryM = v.entryKm * 1000
    if (fromM < entryM && entryM <= toM) return entryM
  }
  return null
}
