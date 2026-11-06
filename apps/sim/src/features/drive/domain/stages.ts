import { toInstant, type RoutePlan } from '@antler/zones'
import type { DriveScenario } from '../types'

// 走る区間「ステージ」（drive-tune R1）。鹿ゾーンの区間ごとに、入口の 5 km 手前から出口まで。
// 運転は最初のステージの始まりから始め、出口を越えたらクリアして次のステージへ移る。最後のクリアでその日の旅程をクリア。

/** 入口の何 m 手前から走るか */
export const STAGE_LEAD_M = 5000

export type Stage = {
  /** 走り始める道のり（m） */
  startM: number
  /** 最後の区間の出口（m）。これを越えたらクリア */
  exitM: number
  /** このステージに入る区間の番号（RoutePlan.intervals の添字） */
  intervals: number[]
}

/** 区間ごとに [入口 − 5 km, 出口]。始点より前にはしない。重なる・続くものはまとめる（UC-1a） */
export function buildStages(plan: RoutePlan): Stage[] {
  const stages: Stage[] = []
  plan.intervals.forEach((v, i) => {
    const startM = Math.max(0, v.entryKm * 1000 - STAGE_LEAD_M)
    const exitM = v.exitKm * 1000
    const last = stages[stages.length - 1]
    if (last && startM <= last.exitM) {
      last.exitM = Math.max(last.exitM, exitM)
      last.intervals.push(i)
    } else {
      stages.push({ startM, exitM, intervals: [i] })
    }
  })
  return stages
}

/**
 * 道のり s のとき、しおりどおりに走っていれば何時か（epoch ms。UC-1b）。
 * その移動の出発時刻に、移動の平均の速さで s まで走った時間を足す
 */
export function scheduledClockAt(scenario: DriveScenario, sM: number): number {
  let leg = scenario.legPace[0]
  for (const l of scenario.legPace) if (l.sM <= sM) leg = l
  if (!leg) return toInstant(scenario.startAt)
  return toInstant(leg.departAt) + (Math.max(0, sM - leg.sM) / leg.mps) * 1000
}
