import { describe, expect, it } from 'vitest'
import {
  AckMessageSchema,
  ClientMessageSchema,
  LabelMessageSchema,
  VehicleMessageSchema,
} from './client-message'
import { buildJsonSchema } from './json-schema'
import { loadFixture, loadFixtures } from './test-fixtures'

// docs/specs/pwa-uplink/functional.md UC-1（R1）と threat.md の ❌ セル（MASS-1）。

const vehicle = (patch: Record<string, unknown> = {}) => ({ type: 'vehicle', ...patch })

describe('UC-1 vehicle の形（R1）', () => {
  it('VM-1a: 3 項目すべて・一部・空が通る', () => {
    for (const name of ['vehicle-full', 'vehicle-partial', 'vehicle-empty', 'vehicle-zero-speed']) {
      const value = loadFixture('client-message', 'valid', name)
      expect(ClientMessageSchema.safeParse(value).success, name).toBe(true)
      expect(VehicleMessageSchema.safeParse(value).success, name).toBe(true)
    }
  })

  it('VM-1a: 速度は 0 と 300 まで通る', () => {
    expect(ClientMessageSchema.safeParse(vehicle({ speedKmh: 0 })).success).toBe(true)
    expect(ClientMessageSchema.safeParse(vehicle({ speedKmh: 300 })).success).toBe(true)
  })

  it('VM-1b: 範囲外・NaN・Infinity・文字列・bool・null・zone の unknown/null・知らない光 → 拒否', () => {
    const bad: Record<string, unknown>[] = [
      { speedKmh: -1 },
      { speedKmh: 301 },
      { speedKmh: Number.NaN },
      { speedKmh: Number.POSITIVE_INFINITY },
      { speedKmh: '42' },
      { speedKmh: true },
      { speedKmh: null },
      { zone: 'unknown' },
      { zone: null },
      { zone: 'INSIDE' },
      { light: 'noon' },
      { light: null },
    ]
    for (const patch of bad) {
      expect(ClientMessageSchema.safeParse(vehicle(patch)).success, JSON.stringify(patch)).toBe(
        false,
      )
    }
  })

  it('VM-1b: 見本の invalid はすべて拒否される', () => {
    const bad = loadFixtures('client-message', 'invalid').filter((f) =>
      f.name.startsWith('vehicle-'),
    )
    expect(bad.length).toBeGreaterThanOrEqual(10)
    for (const f of bad) {
      expect(ClientMessageSchema.safeParse(f.value).success, f.name).toBe(false)
    }
  })

  it('VM-1c: [MASS] 位置・精度・時刻・端末識別子・残り km の項目を足すと拒否される', () => {
    const extras: Record<string, unknown>[] = [
      { lat: 43.1751 },
      { lon: 144.3 },
      { latitude: 43.1751, longitude: 144.3 },
      { accuracyM: 8 },
      { timestamp: 1_800_000_000_000 },
      { t_shown: '2027-02-15T16:31:08.360+09:00' },
      { t_sent: '2027-02-15T16:31:08.360+09:00' },
      { deviceId: 'IDFA-1' },
      { remainingKm: 3.2 },
      { zoneId: 'R12-kamuikotan-1' },
      { speedMps: 11.6 },
      { headlight: 'low' },
      { role: 'admin' },
    ]
    for (const extra of extras) {
      const value = vehicle({ speedKmh: 42, zone: 'inside', light: 'dusk', ...extra })
      expect(ClientMessageSchema.safeParse(value).success, JSON.stringify(extra)).toBe(false)
    }
  })

  it('VM-1c: ack・label の項目を vehicle に混ぜると拒否される（ほかの型として通らない）', () => {
    expect(ClientMessageSchema.safeParse(vehicle({ value: 'present' })).success).toBe(false)
    expect(
      ClientMessageSchema.safeParse({
        type: 'ack',
        t_shown: '2027-02-15T16:31:08.360+09:00',
        speedKmh: 42,
      }).success,
    ).toBe(false)
  })

  it('VM-1d: ack・label は今までどおり通り、flag の形はクライアント → サーバーで拒否のまま', () => {
    expect(AckMessageSchema.safeParse(loadFixture('client-message', 'valid', 'ack')).success).toBe(
      true,
    )
    expect(
      LabelMessageSchema.safeParse(loadFixture('client-message', 'valid', 'label')).success,
    ).toBe(true)
    expect(
      ClientMessageSchema.safeParse(loadFixture('alert-flag', 'valid', 'ch7-example')).success,
    ).toBe(false)
    expect(ClientMessageSchema.safeParse({ type: 'position', lat: 1, lon: 2 }).success).toBe(false)
  })

  it('VM-1d: JSON Schema の ack・label の枝は先頭の 2 つのまま、項目も必須も変わらない', () => {
    const { oneOf } = buildJsonSchema('client-message') as {
      oneOf: {
        properties: Record<string, unknown>
        required: string[]
        additionalProperties: boolean
      }[]
    }
    expect(oneOf).toHaveLength(3)
    expect(Object.keys(oneOf[0]!.properties)).toEqual(['type', 't_shown'])
    expect(oneOf[0]!.required).toEqual(['type', 't_shown'])
    expect(Object.keys(oneOf[1]!.properties)).toEqual(['type', 'value'])
    expect(oneOf[1]!.required).toEqual(['type', 'value'])
    expect(oneOf.every((b) => b.additionalProperties === false)).toBe(true)
    // 追加の枝は 3 つ目。項目はすべて任意（required は type だけ）
    expect(Object.keys(oneOf[2]!.properties)).toEqual(['type', 'speedKmh', 'zone', 'light'])
    expect(oneOf[2]!.required).toEqual(['type'])
  })
})
