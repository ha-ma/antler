import { describe, expect, it } from 'vitest'
import { DriveRunInputSchema, MAX_ENCOUNTERS_PER_RUN, type DriveRunInput } from './run'

// docs/specs/record/functional.md UC-1（R2 走行の記録の形）

const encounter = {
  pattern: 'roadside',
  at: '2027-02-15T16:31:08+09:00',
  alertToBrakeMs: 1200,
  closestM: 18,
  outcome: 'avoided',
} as const

const VALID_RUN: DriveRunInput = {
  runId: '3f0c8a52-1d4e-4b6a-9c2d-7e1f0a9b8c3d',
  day: 2,
  alertEnabled: true,
  outcome: 'completed',
  zonePasses: 2,
  encounters: [encounter],
  frames: { fpsMedian: 60, fpsP5: 48.5, frames: 3600 },
}

describe('DriveRunInputSchema', () => {
  it('UC-1a: 正しい run が通る', () => {
    expect(DriveRunInputSchema.safeParse(VALID_RUN).success).toBe(true)
  })

  it.each([
    ['runId が UUID でない', { runId: 'abc' }],
    ['day が 0', { day: 0 }],
    ['day が小数', { day: 1.5 }],
    ['outcome が pending', { outcome: 'driving' }],
    ['zonePasses が 51', { zonePasses: 51 }],
    [
      `encounters が ${String(MAX_ENCOUNTERS_PER_RUN + 1)} 件`,
      { encounters: Array.from({ length: MAX_ENCOUNTERS_PER_RUN + 1 }, () => encounter) },
    ],
    ['closestM が 501', { encounters: [{ ...encounter, closestM: 501 }] }],
    ['遭遇の outcome が pending', { encounters: [{ ...encounter, outcome: 'pending' }] }],
    ['遭遇の pattern が知らない語', { encounters: [{ ...encounter, pattern: 'flying' }] }],
    ['知らない欄（tripId）', { tripId: 'K7m2abcd' }],
    ['知らない欄（createdAt）', { createdAt: '2027-02-15T16:31:08+09:00' }],
    ['知らない欄（seed）', { seed: 1 }],
  ])('UC-1a / MASS-1: %s → 通らない', (_name, patch) => {
    expect(DriveRunInputSchema.safeParse({ ...VALID_RUN, ...patch }).success).toBe(false)
  })

  it('UC-1b: at は ISO か null、alertToBrakeMs は 0〜60,000 か null、frames は null を許す', () => {
    const ok = {
      ...VALID_RUN,
      encounters: [{ ...encounter, at: null, alertToBrakeMs: null }],
      frames: null,
    }
    expect(DriveRunInputSchema.safeParse(ok).success).toBe(true)
    const late = { ...VALID_RUN, encounters: [{ ...encounter, alertToBrakeMs: 60_001 }] }
    expect(DriveRunInputSchema.safeParse(late).success).toBe(false)
    const noZone = { ...VALID_RUN, encounters: [{ ...encounter, at: '2027-02-15T16:31:08' }] }
    expect(DriveRunInputSchema.safeParse(noZone).success).toBe(false)
  })
})
