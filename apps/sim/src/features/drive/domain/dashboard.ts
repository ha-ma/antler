import type { LightPeriod } from '@antler/zones'
import { jstMonth } from '@antler/zones'
import type { World } from '../types'
import { clockMs } from './simulation'

// ダッシュボードに出す値（drive-tune R5）。3D の計器（scene/）と HUD が毎フレーム読む。World から作る純粋関数。

export type NavHint =
  /** ゾーンの外。次の鹿ゾーンまで km */
  | { kind: 'zone-ahead'; km: number }
  /** ゾーンの中。出口まで km */
  | { kind: 'in-zone'; km: number }
  /** この先にゾーンが無い。目的地（ルートの終点）まで km */
  | { kind: 'destination'; km: number }

export type Dashboard = {
  speedKmh: number
  rpm: number
  /** 1〜6 の段、後退は 'R' */
  gear: number | 'R'
  /** 時計（epoch ms。表示は JST） */
  clockMs: number
  outsideTempC: number
  /** ABS が働いている（灯を点ける） */
  abs: boolean
  /** ブレーキの強さ（0〜1。立ち上がりを含む） */
  brake: number
  nav: NavHint
}

/**
 * 外気温の目安（°C）。道東（釧路）の月ごとの平年の日最高・日最低を、昼と夜に当てた表（推奨で決定。目安）。
 * 薄暮・夜明けは昼と夜の間
 */
const TEMP_C: readonly (readonly [day: number, night: number])[] = [
  [-1, -12], // 1 月
  [-4, -14], // 2 月（drive-tune UC-4c の例）
  [1, -8], // 3 月
  [7, -1], // 4 月
  [12, 4], // 5 月
  [15, 9], // 6 月
  [19, 14], // 7 月
  [21, 16], // 8 月
  [20, 13], // 9 月
  [15, 6], // 10 月
  [8, -1], // 11 月
  [2, -8], // 12 月
]

export function outsideTempC(atMs: number, light: LightPeriod): number {
  const [day, night] = TEMP_C[jstMonth(atMs) - 1] ?? [0, 0]
  if (light === 'day') return day
  if (light === 'night') return night
  return Math.round((day + night) / 2)
}

/** 次の案内（UC-4d） */
export function navHint(world: World): NavHint {
  const { zone, plan } = world
  if (zone.gps.status === 'inside') return { kind: 'in-zone', km: zone.gps.remainingKm ?? 0 }
  if (zone.gps.distanceKm !== undefined) return { kind: 'zone-ahead', km: zone.gps.distanceKm }
  return { kind: 'destination', km: Math.max(0, plan.totalKm - world.vehicle.s / 1000) }
}

export function dashboardOf(world: World): Dashboard {
  const at = clockMs(world)
  return {
    speedKmh: Math.abs(world.vehicle.speed) * 3.6,
    rpm: world.powertrain.rpm,
    gear: world.powertrain.gear,
    clockMs: at,
    outsideTempC: outsideTempC(at, world.light),
    abs: world.vehicle.abs,
    brake: world.vehicle.brakeLevel,
    nav: navHint(world),
  }
}
