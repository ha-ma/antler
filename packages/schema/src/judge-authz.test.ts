import { describe, expect, it } from 'vitest'
import { AlertFlagSchema, readAlertFlag } from './alert-flag'
import { CaptureSchema, isUploadable } from './capture'
import { ClientMessageSchema } from './client-message'
import { JudgeRequestSchema } from './judge-request'
import { loadFixture } from './test-fixtures'

// docs/specs/schema-judge/threat.md の認可マトリクスの ❌ 13 セルと MASS-1。

type Json = Record<string, unknown>
const request = () => loadFixture('judge-request', 'valid', 'ch7-example') as Json
const withState = (patch: Json) => ({
  ...request(),
  state: { ...(request()['state'] as Json), ...patch },
})
const capture = (source: 'sim' | 'vehicle', patch: Json = {}) => ({
  ...(loadFixture('capture', 'valid', 'with-l1probs') as Json),
  source,
  ...patch,
})
const probs = () => (loadFixture('capture', 'valid', 'with-l1probs') as { l1Probs: Json }).l1Probs

describe('threat.md 認可マトリクス（schema-judge）', () => {
  it('AUTH-1: JudgeRequest の state に frameJpegB64 を入れると拒否される（edge・A/dataset）', () => {
    expect(JudgeRequestSchema.safeParse(withState({ frameJpegB64: 'AAAA' })).success).toBe(false)
    expect(JudgeRequestSchema.safeParse(withState({ frameJpegB64: null })).success).toBe(false)
  })

  it('AUTH-2: JudgeRequest の state に lat・lng・deviceId を入れると拒否される（edge・A/dataset）', () => {
    for (const patch of [{ lat: 43.1751 }, { lng: 144.3 }, { deviceId: 'IDFA-1' }]) {
      expect(JudgeRequestSchema.safeParse(withState(patch)).success, JSON.stringify(patch)).toBe(
        false,
      )
    }
  })

  it('AUTH-3: JudgeRequest の質問文・順序・件数を変えると拒否される（edge・A/dataset）', () => {
    const questions = request()['questions'] as Json[]
    const variants = [
      questions.map((q, i) => (i === 0 ? { ...q, text: 'Which alert now?' } : q)),
      [questions[1], questions[0], questions[2], questions[3]],
      questions.slice(0, 3),
    ]
    for (const [i, q] of variants.entries()) {
      expect(JudgeRequestSchema.safeParse({ ...request(), questions: q }).success, `${i}`).toBe(
        false,
      )
    }
  })

  it('AUTH-4: PWA が l1 つきの flag の形をクライアント → サーバーで送ると ClientMessage の検証で拒否される', () => {
    expect(
      ClientMessageSchema.safeParse(loadFixture('alert-flag', 'valid', 'with-l1')).success,
    ).toBe(false)
  })

  it('AUTH-5: readAlertFlag は l1 つきでも l1 を返さない（PWA の表示の入力に l1 が無い）', () => {
    const flag = loadFixture('alert-flag', 'valid', 'with-l1')
    expect(AlertFlagSchema.safeParse(flag).success).toBe(true)
    expect(readAlertFlag(flag).flag).not.toHaveProperty('l1')
    expect(JSON.stringify(readAlertFlag(flag))).not.toContain('overrode')
  })

  it('AUTH-6: edge・A が作る Capture の l1Probs に lat などの余分なキーを入れると拒否される', () => {
    for (const source of ['vehicle', 'sim'] as const) {
      expect(
        CaptureSchema.safeParse(capture(source, { l1Probs: { ...probs(), lat: 43.1751 } })).success,
        source,
      ).toBe(false)
      expect(
        CaptureSchema.safeParse(capture(source, { l1Probs: { ...probs(), lng: 144.3 } })).success,
        source,
      ).toBe(false)
    }
  })

  it('AUTH-7: API が受け取る Capture の l1Probs に deviceId があると拒否される', () => {
    expect(
      CaptureSchema.safeParse(capture('sim', { l1Probs: { ...probs(), deviceId: 'IDFA-1' } }))
        .success,
    ).toBe(false)
  })

  it('AUTH-8: consent:false の Capture は l1Probs つきでも edge・A のどちらから来ても isUploadable が false', () => {
    expect(isUploadable(capture('vehicle', { consent: false }))).toBe(false)
    expect(isUploadable(capture('sim', { consent: false }))).toBe(false)
    expect(isUploadable(capture('sim'))).toBe(true)
  })

  it('MASS-1: JudgeRequest・l1・l1Probs に余分なフィールドを足すと拒否される', () => {
    expect(JudgeRequestSchema.safeParse({ ...request(), role: 'admin' }).success).toBe(false)
    const flag = loadFixture('alert-flag', 'valid', 'with-l1') as { l1: Json }
    expect(AlertFlagSchema.safeParse({ ...flag, l1: { ...flag.l1, isAdmin: true } }).success).toBe(
      false,
    )
    expect(
      CaptureSchema.safeParse(capture('sim', { l1Probs: { ...probs(), internalScore: 1 } }))
        .success,
    ).toBe(false)
  })
})
