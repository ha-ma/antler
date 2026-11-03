import { toJst } from '@antler/schema'
import { distanceToPolyline, inHokkaido, segmentDistanceToPolyline, type LonLat } from './geo'
import type { ZoneCollection, ZoneFeature } from './zone-db'

// GPS の位置からゾーンの内外を決める（functional.md R2・R3 の B・R4・R9。B4-5 の判定はスマホ側）。
// 純粋関数。前回の結果を渡して呼び続ける。alert-ui の deriveAlertState には toGpsZone で渡す。

/** これ以内なら入る（中心線からの距離 m） */
export const ENTER_M = 150
/** inside のあと、これを超えたら出る（ヒステリシス） */
export const EXIT_M = 200
/** 誤差がこれを超えたら、誤差の円で判定する */
export const POOR_ACCURACY_M = 100
/** これより古い測位は使わない */
export const STALE_MS = 10_000
/** 到達予定を出す最低の速さ（km/h） */
export const ETA_MIN_KMH = 5
/** 誤差がこれを超えた測位は使わない（m） */
export const MAX_ACCURACY_M = 1000
/** これより長い空白のあいだの直線は、通過に数えない（実際の道筋が分からない） */
export const PASSAGE_MAX_GAP_MS = 120_000
/** これより小さい動きでは、進む向きを変えない（止まっているときの GPS の揺れ） */
const DIRECTION_MIN_M = 5

export type Fix = {
  lon: number
  lat: number
  /** 誤差（m）。無ければ精度は十分とみなす */
  accuracyM?: number | undefined
  /** 測位の時刻（ms） */
  timestamp: number
  /** 速さ（m/s） */
  speedMps?: number | undefined
}

export type RoadName = ZoneFeature['properties']['roadName']

export type ZoneJudgement = {
  status: 'inside' | 'outside' | 'unknown'
  /** inside: いまのゾーン。outside: いちばん近いゾーン */
  zoneId?: string
  /** inside: 出口までの残り km */
  remainingKm?: number
  /** outside: いちばん近いゾーンの縁までの直線距離 km */
  distanceKm?: number
  /** zoneId の路線名（4 言語） */
  roadName?: RoadName
  /** outside: 到達予定（JST の ISO 8601）。遅すぎる・速さが無ければ無し */
  eta?: string
  /** このゾーンに入った瞬間（中から出発した場合も）。A の 1× 固定とチャイムに使う */
  enterZone: boolean
  /** 前回と今回の測位のあいだに、inside と判定せずに横切ったゾーン（A7-2 の通過回数） */
  passages: string[]
  /** 最後に inside だったゾーン（unknown のあいだも持ち越す。戻ったときに enterZone を立てない） */
  lastInsideZoneId?: string
  /** inside のとき中心線のどちら向きに進んでいるか（止まって揺れても反転させないために持ち越す） */
  direction?: 'forward' | 'backward'
  /** 次の呼び出しで使う、最後に使えた測位 */
  lastFix?: Fix
}

type Nearest = { zone: ZoneFeature; distanceM: number; alongM: number; totalM: number }

function nearestZone(p: LonLat, zones: ZoneCollection): Nearest | null {
  let best: Nearest | null = null
  for (const zone of zones.features) {
    const proj = distanceToPolyline(p, zone.properties.centerline)
    if (!best || proj.distanceM < best.distanceM) best = { zone, ...proj }
  }
  return best
}

function unknown(previous: ZoneJudgement | null): ZoneJudgement {
  const j: ZoneJudgement = { status: 'unknown', enterZone: false, passages: [] }
  if (previous?.lastInsideZoneId) j.lastInsideZoneId = previous.lastInsideZoneId
  if (previous?.lastFix) j.lastFix = previous.lastFix
  return j
}

export function judgeZone({
  fix,
  now,
  previous,
  zones,
}: {
  fix: Fix | null
  now: number
  previous: ZoneJudgement | null
  zones: ZoneCollection
}): ZoneJudgement {
  if (!fix || !usableFix(fix) || now - fix.timestamp > STALE_MS) return unknown(previous)
  const p: LonLat = [fix.lon, fix.lat]
  if (!inHokkaido(p)) return unknown(previous)
  const closest = nearestZone(p, zones)
  if (!closest) return unknown(previous)

  // 最後に inside だったゾーンがまだ出口側の猶予（200 m）の中なら、別のゾーンが近くてもそちらを続ける
  // （隣り合うゾーンで zoneId が入れ替わって enterZone が立ち直さないように）。unknown を挟んでも同じ
  const keptId =
    previous?.status === 'inside' || previous?.status === 'unknown'
      ? previous.lastInsideZoneId
      : undefined
  const kept = keptId ? zoneProjection(p, zones, keptId) : null
  const nearest = kept && kept.distanceM <= EXIT_M ? kept : closest
  const wasInside = nearest.zone.id === keptId

  const accuracy = fix.accuracyM ?? 0
  // ちょうど 150 m を inside にするため、浮動小数の誤差ぶん（1 cm）だけ余裕を持たせる
  const limit = (wasInside ? EXIT_M : ENTER_M) + 0.01
  let inside: boolean
  if (accuracy > POOR_ACCURACY_M) {
    // 誤差の円がゾーンに重なれば inside（安全側）。重ならなければ判断しない
    if (nearest.distanceM - accuracy > limit) return unknown(previous)
    inside = true
  } else {
    inside = nearest.distanceM <= limit
  }

  const passages = crossedZones(previous, fix, p, zones, inside ? nearest.zone.id : undefined)
  const { zone } = nearest
  const base = { roadName: zone.properties.roadName, passages, lastFix: fix }

  if (inside) {
    const enterZone = previous?.status === 'outside' || previous?.lastInsideZoneId !== zone.id
    const direction = movingDirection(nearest, previous)
    const j: ZoneJudgement = {
      status: 'inside',
      zoneId: zone.id,
      remainingKm: remainingKm(nearest, direction),
      enterZone,
      lastInsideZoneId: zone.id,
      ...base,
    }
    if (direction) j.direction = direction
    return j
  }

  const distanceKm = Math.max(0, nearest.distanceM - ENTER_M) / 1000
  const out: ZoneJudgement = {
    status: 'outside',
    zoneId: zone.id,
    distanceKm,
    enterZone: false,
    ...base,
  }
  const kmh = (fix.speedMps ?? 0) * 3.6
  if (kmh >= ETA_MIN_KMH) {
    out.eta = toJst(new Date(now + (distanceKm / kmh) * 3_600_000).toISOString())
  }
  return out
}

function usableFix(fix: Fix): boolean {
  const numbers = [fix.lon, fix.lat, fix.timestamp]
  if (!numbers.every(Number.isFinite)) return false
  if (
    fix.accuracyM !== undefined &&
    (!Number.isFinite(fix.accuracyM) || fix.accuracyM > MAX_ACCURACY_M)
  ) {
    return false
  }
  return true
}

function zoneProjection(p: LonLat, zones: ZoneCollection, id: string): Nearest | null {
  const zone = zones.features.find((z) => z.id === id)
  return zone ? { zone, ...distanceToPolyline(p, zone.properties.centerline) } : null
}

/** 進む向きは前回の測位を中心線に落とした位置との差で決める。5 m 未満の動きでは前回の向きを保つ。 */
function movingDirection(
  n: Nearest,
  previous: ZoneJudgement | null,
): 'forward' | 'backward' | undefined {
  const prevFix = previous?.lastFix
  const sameZone = previous?.lastInsideZoneId === n.zone.id
  if (!prevFix || !sameZone) return undefined
  const prevAlong = distanceToPolyline(
    [prevFix.lon, prevFix.lat],
    n.zone.properties.centerline,
  ).alongM
  if (n.alongM > prevAlong + DIRECTION_MIN_M) return 'forward'
  if (n.alongM < prevAlong - DIRECTION_MIN_M) return 'backward'
  return previous.direction
}

/** 向きが分からなければ長い方（安全側）。 */
function remainingKm(n: Nearest, direction: 'forward' | 'backward' | undefined): number {
  const toEnd = n.totalM - n.alongM
  const toStart = n.alongM
  if (direction === 'forward') return toEnd / 1000
  if (direction === 'backward') return toStart / 1000
  return Math.max(toEnd, toStart) / 1000
}

/** 前回の測位から今回までの線分が、inside と判定しなかったゾーンを横切ったか（R4）。 */
function crossedZones(
  previous: ZoneJudgement | null,
  fix: Fix,
  p: LonLat,
  zones: ZoneCollection,
  insideZoneId: string | undefined,
): string[] {
  const prevFix = previous?.lastFix
  if (!prevFix || fix.timestamp - prevFix.timestamp > PASSAGE_MAX_GAP_MS) return []
  const q: LonLat = [prevFix.lon, prevFix.lat]
  const out: string[] = []
  for (const zone of zones.features) {
    if (zone.id === insideZoneId) continue
    // 最後に inside だったゾーン（unknown を挟んでも）は、入ったときに数えているので通過にしない
    if (previous?.lastInsideZoneId === zone.id) continue
    if (segmentDistanceToPolyline(q, p, zone.properties.centerline) <= ENTER_M) out.push(zone.id)
  }
  return out
}

/** alert-ui の deriveAlertState が受け取る GpsZone の形に直す。 */
export function toGpsZone(
  j: ZoneJudgement,
):
  | { status: 'inside'; remainingKm?: number }
  | { status: 'outside'; distanceKm?: number }
  | { status: 'unknown' } {
  if (j.status === 'inside')
    return j.remainingKm === undefined
      ? { status: 'inside' }
      : { status: 'inside', remainingKm: j.remainingKm }
  if (j.status === 'outside')
    return j.distanceKm === undefined
      ? { status: 'outside' }
      : { status: 'outside', distanceKm: j.distanceKm }
  return { status: 'unknown' }
}
