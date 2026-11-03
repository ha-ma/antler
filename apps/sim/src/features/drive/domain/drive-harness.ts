import type { DriveInput, World } from '../types'
import { NO_INPUT } from '../types'

// 頭なしで走らせるための運転者（受け入れテスト用）。乱数を使わず World だけから入力を決めるので、
// 同じ World なら同じ入力の列になる（R4「同じ運転」）。

/**
 * 気づいた運転者: 60 km/h を保ち、赤では 30 km/h まで落とす。道の近く（中心線から 7 m 以内）の 80 m 先に
 * 鹿が見えたら 20 km/h まで落とし、自分の車線の 40 m 先にいたら止まる。
 * 路肩の鹿で赤が続いても止まりきらない（止まると鹿が去らず先へ進めない）。
 */
export function attentiveDriver(world: World, cruiseKmh = 60): DriveInput {
  const v = world.vehicle
  const kmh = v.speed * 3.6
  const ahead = world.deer.filter((d) => !d.gone && !d.occluded && d.s > v.s - 3)
  const inLane = ahead.some((d) => d.s - v.s < 40 && Math.abs(d.d - v.d) < 2.2)
  if (inLane) return { ...NO_INPUT, brake: kmh > 0.5 }
  const nearRoad = ahead.some((d) => d.s - v.s < 80 && Math.abs(d.d) < 7)
  const target = nearRoad ? 20 : world.alert.state === 'danger' ? 30 : cruiseKmh
  if (kmh > target + 2) return { ...NO_INPUT, brake: true }
  return { ...NO_INPUT, throttle: kmh < target }
}
