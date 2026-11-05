import { ClientMessageSchema } from '@antler/schema'
import type { Fix } from '@antler/zones'
import { describe, expect, it } from 'vitest'
import { MAX_SPEED_KMH, REPORT_FRESH_MS, toVehicleReport } from './vehicle-report'

// docs/specs/pwa-uplink UC-2（R2）。座標は出さない。古い・負・NaN は項目なし、3 項目とも無ければ null。

const KUSHIRO = { lat: 42.98, lon: 144.38 }
const NOON = Date.parse('2027-02-15T12:00:00+09:00')

function fix(over: Partial<Fix> = {}, now = NOON): Fix {
  return { ...KUSHIRO, accuracyM: 8, timestamp: now, speedMps: 10, ...over }
}

describe('VR-2a 速度', () => {
  it('m/s を km/h に直して四捨五入する（10 m/s → 36）', () => {
    expect(toVehicleReport({ fix: fix(), now: NOON, status: 'inside' })?.speedKmh).toBe(36)
    expect(
      toVehicleReport({ fix: fix({ speedMps: 12.5 }), now: NOON, status: 'inside' })?.speedKmh,
    ).toBe(45)
  })

  it('0 m/s は 0（停止）として送る', () => {
    expect(
      toVehicleReport({ fix: fix({ speedMps: 0 }), now: NOON, status: 'inside' })?.speedKmh,
    ).toBe(0)
  })

  it('速さが無い・負・NaN・Infinity は項目なし（0 にしない）', () => {
    for (const speedMps of [undefined, -1, -0.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      const report = toVehicleReport({ fix: fix({ speedMps }), now: NOON, status: 'inside' })
      expect(report).not.toBeNull()
      expect(report).not.toHaveProperty('speedKmh')
      expect(report?.zone).toBe('inside')
    }
  })

  it('301 km/h 以上は 300 に収める', () => {
    const report = toVehicleReport({ fix: fix({ speedMps: 200 }), now: NOON, status: 'inside' })
    expect(report?.speedKmh).toBe(MAX_SPEED_KMH)
  })
})

describe('VR-2b ゾーン', () => {
  it('inside / outside はそのまま入る', () => {
    expect(toVehicleReport({ fix: fix(), now: NOON, status: 'inside' })?.zone).toBe('inside')
    expect(toVehicleReport({ fix: fix(), now: NOON, status: 'outside' })?.zone).toBe('outside')
  })

  it('unknown・判定なしは zone も light も項目なし（速度だけ残りうる）', () => {
    for (const status of ['unknown', null] as const) {
      const report = toVehicleReport({ fix: fix(), now: NOON, status })
      expect(report).toEqual({ speedKmh: 36 })
    }
  })
})

describe('VR-2c 光', () => {
  const cases = [
    ['2027-02-15T12:00:00+09:00', 'day'],
    ['2027-02-15T21:00:00+09:00', 'night'],
    ['2026-11-16T15:45:00+09:00', 'dusk'],
    ['2026-11-16T06:00:00+09:00', 'dawn'],
  ] as const
  for (const [iso, light] of cases) {
    it(`${iso} は ${light}`, () => {
      const now = Date.parse(iso)
      const report = toVehicleReport({ fix: fix({}, now), now, status: 'inside' })
      expect(report?.light).toBe(light)
    })
  }
})

describe('VR-2d 座標を出さない・形が通る', () => {
  it('キーは speedKmh・zone・light だけで、ClientMessage に通る', () => {
    const report = toVehicleReport({ fix: fix(), now: NOON, status: 'inside' })
    expect(Object.keys(report ?? {}).sort()).toEqual(['light', 'speedKmh', 'zone'])
    const json = JSON.stringify(report)
    expect(json).not.toContain('42.98')
    expect(json).not.toContain('144.38')
    expect(ClientMessageSchema.safeParse({ type: 'vehicle', ...report }).success).toBe(true)
  })
})

describe('VR-2e・VR-2f 測位が無い・古い・時計が戻る → null', () => {
  it('測位なし → null', () => {
    expect(toVehicleReport({ fix: null, now: NOON, status: 'inside' })).toBeNull()
  })

  it(`${REPORT_FRESH_MS} ms ちょうどまでは新しい。超えたら null`, () => {
    expect(
      toVehicleReport({ fix: fix({}, NOON - REPORT_FRESH_MS), now: NOON, status: 'inside' }),
    ).not.toBeNull()
    expect(
      toVehicleReport({ fix: fix({}, NOON - REPORT_FRESH_MS - 1), now: NOON, status: 'inside' }),
    ).toBeNull()
  })

  it('端末の時計が戻って経過が負なら古い扱い（null）', () => {
    const f = fix({}, NOON + 3_600_000) // 1 時間後の時刻の測位を、時計が戻ったあとの now で見る
    expect(toVehicleReport({ fix: f, now: NOON, status: 'inside' })).toBeNull()
    expect(toVehicleReport({ fix: fix({}, NOON + 1), now: NOON, status: 'inside' })).toBeNull()
  })

  it('測位は新しいが 3 項目とも分からない → null（空のメッセージを送らない）', () => {
    expect(
      toVehicleReport({ fix: fix({ speedMps: undefined }), now: NOON, status: 'unknown' }),
    ).toBeNull()
  })

  it('緯度経度が数でない測位でも例外にしない', () => {
    const bad = fix({ lat: Number.NaN })
    expect(() => toVehicleReport({ fix: bad, now: NOON, status: 'inside' })).not.toThrow()
  })
})
