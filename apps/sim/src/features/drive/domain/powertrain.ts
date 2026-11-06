// オートマの簡単なモデル（drive-tune R5、UC-4b）。回転数とギアをダッシュボードと音（drive-audio-chat）に出す。
// 車の速さとアクセルから毎ステップ決める。走りには効かせない（加速は vehicle.ts）。

export const IDLE_RPM = 750
/** この回転数でシフトアップ（オートマの穏やかな走り。5 速 97.5 km/h で 6 速へ） */
export const SHIFT_UP_RPM = 2500
/** この回転数を下回ったらシフトダウン */
export const SHIFT_DOWN_RPM = 1200
/** 表示の上限（アクセルを踏んだときの滑りを足しても越えない） */
export const MAX_RPM = 3000
export const GEARS = 6
/** 各段で 1,000 rpm のときの速さ（km/h）。1 速 9 km/h … 6 速 48 km/h（6 速 100 km/h で約 2,080 rpm） */
const KMH_PER_1000RPM: readonly number[] = [9, 15, 23, 31, 39, 48]

export type Powertrain = {
  /** 1〜6 の段（後退のときは 'R'） */
  gear: number | 'R'
  rpm: number
}

export const INITIAL_POWERTRAIN: Powertrain = { gear: 1, rpm: IDLE_RPM }

function rpmAt(gear: number, kmh: number): number {
  const ratio = KMH_PER_1000RPM[gear - 1] ?? KMH_PER_1000RPM[0] ?? 9
  return (Math.abs(kmh) / ratio) * 1000
}

/** 速さ（km/h、後退は負）とアクセルから、次の段と回転数 */
export function stepPowertrain(prev: Powertrain, kmh: number, throttle: boolean): Powertrain {
  if (kmh < -0.5) return { gear: 'R', rpm: Math.max(IDLE_RPM, rpmAt(1, kmh)) }
  let gear = prev.gear === 'R' ? 1 : prev.gear
  // 上限を越えたら上げ、下限を下回ったら下げる（1 回に 1 段）
  if (rpmAt(gear, kmh) > SHIFT_UP_RPM && gear < GEARS) gear += 1
  else if (rpmAt(gear, kmh) < SHIFT_DOWN_RPM && gear > 1) gear -= 1
  // アクセルを踏んでいる間は少し高め（トルクコンバータの滑り）、離すと素の回転数
  const base = rpmAt(gear, kmh) * (throttle ? 1.08 : 1)
  return { gear, rpm: Math.min(MAX_RPM, Math.max(IDLE_RPM, base)) }
}
