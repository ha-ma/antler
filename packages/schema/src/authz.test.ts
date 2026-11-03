import { describe, expect, it } from 'vitest'
import { CaptureSchema, isUploadable } from './capture'
import { ClientMessageSchema } from './client-message'
import { loadFixture } from './test-fixtures'
import { TripPlanSchema } from './trip-plan'

// threat.md の認可マトリクスの ❌ 7 セルと MASS-1。

const capture = (source: 'sim' | 'vehicle') => ({
  ...(loadFixture('capture', 'valid', 'ch7-example') as Record<string, unknown>),
  source,
})

describe('threat.md 認可マトリクス', () => {
  it('AUTH-1: PWA が flag の形をクライアント → サーバーで送ると ClientMessage の検証で拒否される', () => {
    const flag = loadFixture('alert-flag', 'valid', 'ch7-example')
    expect(ClientMessageSchema.safeParse(flag).success).toBe(false)
  })

  it('AUTH-2: edge が作る Capture に lat を入れると拒否される', () => {
    expect(CaptureSchema.safeParse({ ...capture('vehicle'), lat: 43.1751 }).success).toBe(false)
  })

  it('AUTH-3: B の PWA が作る Capture に lng を入れると拒否される', () => {
    expect(CaptureSchema.safeParse({ ...capture('vehicle'), lng: 144.3 }).success).toBe(false)
  })

  it('AUTH-4: A が作る Capture に email を入れると拒否される', () => {
    expect(CaptureSchema.safeParse({ ...capture('sim'), email: 'a@example.com' }).success).toBe(
      false,
    )
  })

  it('AUTH-5: API が受け取る Capture に deviceId があると拒否される', () => {
    expect(CaptureSchema.safeParse({ ...capture('sim'), deviceId: 'IDFA-1' }).success).toBe(false)
  })

  it('AUTH-6: consent:false の Capture は edge・A のどちらから来ても isUploadable が false', () => {
    expect(isUploadable({ ...capture('vehicle'), consent: false })).toBe(false)
    expect(isUploadable({ ...capture('sim'), consent: false })).toBe(false)
    expect(isUploadable(capture('sim'))).toBe(true)
    expect(isUploadable({ ...capture('sim'), lat: 1 })).toBe(false)
  })

  it('MASS-1: ClientMessage・Capture・TripPlan に余分なフィールドを足すと拒否される', () => {
    expect(
      ClientMessageSchema.safeParse({ type: 'label', value: 'present', role: 'admin' }).success,
    ).toBe(false)
    expect(CaptureSchema.safeParse({ ...capture('sim'), internalScore: 1 }).success).toBe(false)
    const trip = loadFixture('trip-plan', 'valid', 'ch7-example') as Record<string, unknown>
    expect(TripPlanSchema.safeParse({ ...trip, isAdmin: true }).success).toBe(false)
  })
})
