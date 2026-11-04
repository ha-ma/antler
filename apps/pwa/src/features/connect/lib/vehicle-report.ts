import { lightPeriod, type Fix } from '@antler/zones'
import type { VehicleMessage } from '@antler/schema'

// PWA の GPS から、edge の L1 に返す車の状態を作る（pwa-uplink R2）。
// 載せるのは速度・ゾーンの内外・光の区分の 3 項目だけ。緯度経度・精度・時刻は載せない（型にも席が無い）。

/** 3 項目とも、測位がこれ以内のものだけ作る（ms）。古い・負（端末の時計が戻った）は作らない */
export const REPORT_FRESH_MS = 5000
export const MAX_SPEED_KMH = 300

export type VehicleReport = Omit<VehicleMessage, 'type'>

export type ReportInput = {
  fix: Fix | null
  now: number
  /** judgeZone の結果。判定なしは null */
  status: 'inside' | 'outside' | 'unknown' | null
}

function lightOf(fix: Fix, now: number) {
  try {
    return lightPeriod(now, { lat: fix.lat, lon: fix.lon })
  } catch {
    return undefined // 位置か時刻が数でない。光だけ項目なしにする
  }
}

/** 3 項目とも分からない（または測位が古い）ときは null。送らない。 */
export function toVehicleReport({ fix, now, status }: ReportInput): VehicleReport | null {
  if (!fix) return null
  const age = now - fix.timestamp
  if (!Number.isFinite(age) || age < 0 || age > REPORT_FRESH_MS) return null
  const report: VehicleReport = {}
  const speed = fix.speedMps
  if (typeof speed === 'number' && Number.isFinite(speed) && speed >= 0) {
    report.speedKmh = Math.min(MAX_SPEED_KMH, Math.round(speed * 3.6))
  }
  if (status === 'inside' || status === 'outside') {
    report.zone = status
    const light = lightOf(fix, now)
    if (light) report.light = light
  }
  return Object.keys(report).length > 0 ? report : null
}
