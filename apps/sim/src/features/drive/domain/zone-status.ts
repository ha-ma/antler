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

/**
 * 車の道のり s（m）からゾーン状態を出す（drive-link R5）。planRoute の区間は s と同じ物差し（cumulativeM）なので、
 * measureAlongRoute で全線分を走査せずに同じ答えが出る（1 日 280 km のルートは 20 m 間隔で 1 万 4 千本）。
 * 区間は道のりの順に並び、重ならない（planRoute はルートを前から 1 回なめて、続く inside を 1 つの区間にまとめる。
 * withoutRanges で割っても順は保つ）ので二分探索する。
 */
export function zoneStatusFromS(plan: RoutePlan, sM: number): ZoneStatus {
  const positionKm = Math.min(Math.max(sM / 1000, 0), plan.totalKm)
  const intervals = plan.intervals
  // positionKm より入口が後ろにある最初の区間
  let lo = 0
  let hi = intervals.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((intervals[mid]?.entryKm ?? Infinity) > positionKm) hi = mid
    else lo = mid + 1
  }
  const next = intervals[lo]
  const nextEntryKm = next ? next.entryKm : null
  const current = intervals[lo - 1]
  if (current && positionKm <= current.exitKm) {
    return {
      gps: { status: 'inside', remainingKm: current.exitKm - positionKm },
      interval: lo - 1,
      nextEntryKm,
      positionKm,
    }
  }
  return {
    gps: next
      ? { status: 'outside', distanceKm: next.entryKm - positionKm }
      : { status: 'outside' },
    interval: null,
    nextEntryKm,
    positionKm,
  }
}

/**
 * 道のりの範囲（m）にかかるゾーンの区間を取り除いた RoutePlan（drive-link R5）。直線で引いた概算の移動には
 * 区間を作らない（brief-map R1）。範囲に一部だけかかる区間は、範囲の外の部分だけ残す
 */
export function withoutRanges(plan: RoutePlan, rangesM: readonly [number, number][]): RoutePlan {
  if (rangesM.length === 0) return plan
  let intervals = plan.intervals
  for (const [fromM, toM] of rangesM) {
    const from = fromM / 1000
    const to = toM / 1000
    intervals = intervals.flatMap((v) => {
      if (v.exitKm <= from || v.entryKm >= to) return [v]
      const kept: typeof intervals = []
      // 割った残りは長さが正のものだけ（長さ 0 の区間は出入りがちらつく。alert-contract-guard W-3）
      if (v.entryKm < from) kept.push({ ...v, exitKm: from })
      if (v.exitKm > to) kept.push({ ...v, entryKm: to })
      return kept
    })
  }
  return { ...plan, intervals }
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
