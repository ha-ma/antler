import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AlertFlagSchema } from './alert-flag'
import { CaptureSchema } from './capture'
import { ClientMessageSchema } from './client-message'
import { IsoDateTime, toJst } from './common'
import { JSON_SCHEMA_SOURCES, renderJsonSchema, type JsonSchemaName } from './json-schema'
import { FIXTURES_DIR, loadFixture, loadFixtures } from './test-fixtures'
import { TripPlanSchema } from './trip-plan'

const SCHEMAS = {
  'alert-flag': AlertFlagSchema,
  capture: CaptureSchema,
  'client-message': ClientMessageSchema,
  'trip-plan': TripPlanSchema,
} as const

function names(kind: keyof typeof SCHEMAS, validity: 'valid' | 'invalid', ok: boolean): string[] {
  return loadFixtures(kind, validity)
    .filter((f) => SCHEMAS[kind].safeParse(f.value).success === ok)
    .map((f) => f.name)
}

describe('UC-1 共通スキーマ', () => {
  it('UC-1a: ch7 の AlertFlag・TripPlan・Capture の例（と valid の見本すべて）が通る', () => {
    for (const kind of Object.keys(SCHEMAS) as (keyof typeof SCHEMAS)[]) {
      expect(names(kind, 'valid', false), kind).toEqual([])
    }
    expect(
      AlertFlagSchema.safeParse(loadFixture('alert-flag', 'valid', 'ch7-example')).success,
    ).toBe(true)
  })

  it('UC-1b: AlertFlag の v:2・deer:true で distanceM / side 無し・conf が範囲外 → 拒否', () => {
    for (const n of ['version-2', 'deer-true-no-distance', 'deer-true-no-side', 'conf-over-1']) {
      expect(AlertFlagSchema.safeParse(loadFixture('alert-flag', 'invalid', n)).success, n).toBe(
        false,
      )
    }
  })

  it('UC-1c: inside と zoneDistanceKm、outside と zoneRemainingKm の組み合わせ → 拒否。outside で次ゾーン無し → 通る', () => {
    expect(
      AlertFlagSchema.safeParse(loadFixture('alert-flag', 'invalid', 'inside-with-zone-distance'))
        .success,
    ).toBe(false)
    expect(
      AlertFlagSchema.safeParse(loadFixture('alert-flag', 'invalid', 'outside-with-zone-remaining'))
        .success,
    ).toBe(false)
    expect(
      AlertFlagSchema.safeParse(
        loadFixture('alert-flag', 'valid', 'deer-false-outside-no-next-zone'),
      ).success,
    ).toBe(true)
  })

  it('UC-1d: Capture に lat / lng / email / deviceId → 拒否。consent 無し → 拒否。consent:false → 通る', () => {
    const base = loadFixture('capture', 'valid', 'ch7-example') as Record<string, unknown>
    for (const key of ['lat', 'lng', 'email', 'deviceId']) {
      expect(CaptureSchema.safeParse({ ...base, [key]: 1 }).success, key).toBe(false)
    }
    expect(CaptureSchema.safeParse(loadFixture('capture', 'invalid', 'no-consent')).success).toBe(
      false,
    )
    expect(CaptureSchema.safeParse(loadFixture('capture', 'valid', 'consent-false')).success).toBe(
      true,
    )
  })

  it('UC-1e: roadSegment に座標・空 → 拒否。boxes 0 件 → 通る。xywh が範囲外・reactionMs が負 → 拒否', () => {
    for (const n of [
      'road-segment-coordinates',
      'road-segment-empty',
      'xywh-out-of-range',
      'negative-reaction',
    ]) {
      expect(CaptureSchema.safeParse(loadFixture('capture', 'invalid', n)).success, n).toBe(false)
    }
    expect(
      CaptureSchema.safeParse(loadFixture('capture', 'valid', 'missed-zero-boxes')).success,
    ).toBe(true)
  })

  it('UC-1f: TripPlan の楽しみ 11 件・weight 0 / 6・drivers > size・重複した楽しみ → 拒否', () => {
    for (const n of ['eleven-pleasures', 'weight-0', 'weight-6']) {
      expect(TripPlanSchema.safeParse(loadFixture('trip-plan', 'invalid', n)).success, n).toBe(
        false,
      )
    }
    const trip = loadFixture('trip-plan', 'valid', 'ch7-example') as {
      party: { size: number; drivers: number }
      pleasures: { id: string; weight: number }[]
    }
    expect(
      TripPlanSchema.safeParse({ ...trip, party: { ...trip.party, drivers: 5 } }).success,
    ).toBe(false)
    const dup = { ...trip, pleasures: [trip.pleasures[0], trip.pleasures[0]] }
    expect(TripPlanSchema.safeParse(dup).success).toBe(false)
  })

  it('UC-1g: 時刻は Z と +09:00 が通り、タイムゾーン無しは拒否。toJst が +09:00 に正規化する', () => {
    expect(IsoDateTime.safeParse('2027-02-15T07:31:08.120Z').success).toBe(true)
    expect(IsoDateTime.safeParse('2027-02-15T16:31:08.120+09:00').success).toBe(true)
    expect(IsoDateTime.safeParse('2027-02-15T16:31:08.120').success).toBe(false)
    expect(
      AlertFlagSchema.safeParse(loadFixture('alert-flag', 'invalid', 'no-timezone')).success,
    ).toBe(false)
    expect(toJst('2027-02-15T07:31:08.120Z')).toBe('2027-02-15T16:31:08.120+09:00')
    expect(toJst('2027-02-15T08:31:08+10:00')).toBe('2027-02-15T07:31:08.000+09:00')
    expect(() => toJst('2027-02-15T16:31:08')).toThrow(RangeError)
  })

  it('UC-1h: ClientMessage は ack と label だけ通り、flag の形・余分な項目・知らない type → 拒否', () => {
    expect(names('client-message', 'valid', false)).toEqual([])
    expect(names('client-message', 'invalid', true)).toEqual([])
  })

  it('UC-1i: 書き出した JSON Schema（packages/schema/json/）が定義から作り直したものと一致する', () => {
    for (const name of Object.keys(JSON_SCHEMA_SOURCES) as JsonSchemaName[]) {
      const file = path.resolve(FIXTURES_DIR, '../json', `${name}.schema.json`)
      expect(readFileSync(file, 'utf-8'), `${name}: npm run build:json -w @antler/schema`).toBe(
        renderJsonSchema(name),
      )
    }
  })

  it('invalid の見本はすべて拒否される（edge の契約テストと同じ見本）', () => {
    for (const kind of Object.keys(SCHEMAS) as (keyof typeof SCHEMAS)[]) {
      expect(names(kind, 'invalid', true), kind).toEqual([])
    }
  })
})
