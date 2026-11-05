import { useEffect } from 'react'
import type { VehicleReport } from '../lib/vehicle-report'

/**
 * 走行中（B-1）のあいだ、車の状態を edge に返す（pwa-uplink R3）。1 秒ごとの now の更新に乗る。
 * 3 項目とも分からないとき（report が null）は送らない。0.9 秒に 1 通までは sendVehicle が守る
 * （再描画や StrictMode の二重の effect で増えない）。open でなければ sendVehicle が送らない。
 */
export function useVehicleUplink(
  report: VehicleReport | null,
  now: number,
  sendVehicle: (report: VehicleReport) => boolean,
): void {
  // 描画のあとに車載へ返す副作用（外部との同期）
  // eslint-disable-next-line no-restricted-syntax -- 外部への送信
  useEffect(() => {
    if (report) sendVehicle(report)
    // now が進むたびに送る。report は毎回新しい値なので、now と report の両方で動かす
  }, [report, now, sendVehicle])
}
