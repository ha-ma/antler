import { DriveRunInputSchema } from '@antler/trip'
import { toDriveRun, type FinishedDrive } from './drive-run'

// 運転の結果 → 走行の記録（docs/specs/record/functional.md UC-9f）

const encounter = {
  pattern: 'roadside',
  alertClockAt: '2027-02-15T16:31:08.000+09:00',
  alertToBrakeMs: 1200,
  closestM: 18,
  outcome: 'avoided' as const,
}

const result: FinishedDrive = {
  day: 2,
  alertEnabled: false,
  outcome: 'completed',
  zonePasses: 3,
  encounters: [encounter],
  frames: { fpsMedian: 60, fpsP5: 48, frames: 1200, dropped: 4, counted: 5000 },
}

describe('toDriveRun', () => {
  it('UC-9f: DriveResult の欄から run を作り、スキーマを通る。時刻は alertClockAt', () => {
    const run = toDriveRun(result, '3f0c8a52-1d4e-4b6a-9c2d-7e1f0a9b8c3d')
    expect(DriveRunInputSchema.safeParse(run).success).toBe(true)
    expect(run).toMatchObject({ day: 2, alertEnabled: false, outcome: 'completed', zonePasses: 3 })
    expect(run.encounters[0]?.at).toBe(encounter.alertClockAt)
    // 落ちたフレームと数えたフレームの数もそのまま残す（performance R1）
    expect(run.frames).toEqual({
      fpsMedian: 60,
      fpsP5: 48,
      frames: 1200,
      dropped: 4,
      counted: 5000,
    })
  })

  it('UC-9f: pending の遭遇は送らず、範囲はスキーマの上限に丸める。runId は毎回新しい', () => {
    const run = toDriveRun({
      ...result,
      zonePasses: 80,
      encounters: [
        { ...encounter, outcome: 'pending' },
        { ...encounter, closestM: 900, alertToBrakeMs: 70_000 },
        ...Array.from({ length: 60 }, () => encounter),
      ],
    })
    expect(DriveRunInputSchema.safeParse(run).success).toBe(true)
    expect(run.zonePasses).toBe(50)
    expect(run.encounters).toHaveLength(50)
    expect(run.encounters[0]).toMatchObject({ closestM: 500, alertToBrakeMs: null })
    expect(toDriveRun(result).runId).not.toBe(toDriveRun(result).runId)
  })
})
