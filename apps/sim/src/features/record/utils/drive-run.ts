import {
  DeerPatternSchema,
  MAX_ENCOUNTERS_PER_RUN,
  MAX_ZONE_PASSES,
  type DriveRunInput,
} from '@antler/trip'

// 運転の結果（drive の DriveResult）→ 走行の記録（docs/specs/record/functional.md R2・R11）。
// record は drive に依存しないよう、使う欄だけを構造で受ける（app 層が drive の結果をそのまま渡す）。
// 範囲はスキーマの上限に丸める（長い運転で遭遇が 50 件を超えても保存は失敗させない）。
// pending の遭遇（決着していない鹿）は送らない。遭遇の時刻は alertClockAt（移動の始まりで時計を進めるため）。

export type FinishedDrive = {
  day: number
  alertEnabled: boolean
  outcome: 'completed' | 'collided'
  zonePasses: number
  encounters: readonly {
    pattern: string
    alertClockAt: string | null
    alertToBrakeMs: number | null
    closestM: number
    outcome: 'avoided' | 'collided' | 'pending'
  }[]
  frames: DriveRunInput['frames']
}

const MAX_ALERT_TO_BRAKE_MS = 60_000
const MAX_CLOSEST_M = 500

export function toDriveRun(
  result: FinishedDrive,
  runId: string = crypto.randomUUID(),
): DriveRunInput {
  const encounters = result.encounters.flatMap((e) => {
    const pattern = DeerPatternSchema.safeParse(e.pattern)
    if (e.outcome === 'pending' || !pattern.success) return []
    return [
      {
        pattern: pattern.data,
        at: e.alertClockAt,
        alertToBrakeMs:
          e.alertToBrakeMs === null || e.alertToBrakeMs > MAX_ALERT_TO_BRAKE_MS
            ? null
            : Math.max(0, e.alertToBrakeMs),
        closestM: Math.min(MAX_CLOSEST_M, Math.max(0, e.closestM)),
        outcome: e.outcome,
      },
    ]
  })
  return {
    runId,
    day: result.day,
    alertEnabled: result.alertEnabled,
    outcome: result.outcome,
    zonePasses: Math.min(MAX_ZONE_PASSES, Math.max(0, Math.round(result.zonePasses))),
    encounters: encounters.slice(0, MAX_ENCOUNTERS_PER_RUN),
    frames: result.frames,
  }
}
