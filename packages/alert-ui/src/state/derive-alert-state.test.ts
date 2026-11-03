import type { ReceivedFlag } from '@antler/schema'
import { describe, expect, it } from 'vitest'
import { deriveAlertState, FLAG_FRESH_MS, type AlertInputs } from './derive-alert-state'

const T0 = 1_000_000

const deer = (over: Partial<ReceivedFlag> = {}): ReceivedFlag => ({
  deer: true,
  strict: true,
  conf: 0.94,
  distanceM: 58,
  side: 'L',
  zone: 'inside',
  zoneRemainingKm: 14.2,
  ...over,
})

const clear = (over: Partial<ReceivedFlag> = {}): ReceivedFlag => ({
  deer: false,
  strict: true,
  zone: 'outside',
  zoneDistanceKm: 38,
  ...over,
})

const inputs = (over: Partial<AlertInputs> = {}): AlertInputs => ({
  flag: null,
  flagReceivedAt: null,
  gps: { status: 'outside', distanceKm: 38 },
  now: T0,
  previous: null,
  ...over,
})

describe('UC-2 表示状態の決定（deriveAlertState）', () => {
  it('UC-2a: ゾーン外・フラグなし → safe、GPS の次ゾーンまでの距離', () => {
    expect(deriveAlertState(inputs())).toEqual({ state: 'safe', distance: 38, inZone: false })
  })

  it('UC-2b: GPS inside → zone、残り距離', () => {
    expect(deriveAlertState(inputs({ gps: { status: 'inside', remainingKm: 3.5 } }))).toEqual({
      state: 'zone',
      distance: 3.5,
      inZone: true,
    })
  })

  it('UC-2c: 新しい deer:true → GPS が outside でも danger、距離 m と side', () => {
    const r = deriveAlertState(inputs({ flag: deer({ zone: 'outside' }), flagReceivedAt: T0 }))
    expect(r).toMatchObject({ state: 'danger', distance: 58, side: 'L' })
  })

  it('UC-2d: deer:false が届く → すぐ zone（inside）/ safe（outside）', () => {
    const prev = deriveAlertState(inputs({ flag: deer(), flagReceivedAt: T0 }))
    const inZone = deriveAlertState(
      inputs({
        flag: clear({ zone: 'inside', zoneRemainingKm: 12 }),
        flagReceivedAt: T0 + 100,
        now: T0 + 100,
        gps: { status: 'inside', remainingKm: 12 },
        previous: prev,
      }),
    )
    expect(inZone).toEqual({ state: 'zone', distance: 12, inZone: true })
    const out = deriveAlertState(
      inputs({ flag: clear(), flagReceivedAt: T0 + 100, now: T0 + 100, previous: prev }),
    )
    expect(out).toEqual({ state: 'safe', distance: 38, inZone: false })
  })

  it('UC-2e: 最後が deer:true のまま 5 秒以内 → danger。5 秒を過ぎた → ゾーンの状態', () => {
    const base = {
      flag: deer(),
      flagReceivedAt: T0,
      gps: { status: 'inside' as const, remainingKm: 9 },
    }
    expect(deriveAlertState(inputs({ ...base, now: T0 + FLAG_FRESH_MS })).state).toBe('danger')
    expect(deriveAlertState(inputs({ ...base, now: T0 + FLAG_FRESH_MS + 1 }))).toEqual({
      state: 'zone',
      distance: 9,
      inZone: true,
    })
  })

  it('UC-2f: フラグの zone が inside・GPS が outside → zone。逆も zone', () => {
    const flagInside = deriveAlertState(
      inputs({ flag: clear({ zone: 'inside', zoneRemainingKm: 4 }), flagReceivedAt: T0 }),
    )
    expect(flagInside).toMatchObject({ state: 'zone', inZone: true })
    const gpsInside = deriveAlertState(
      inputs({ flag: clear(), flagReceivedAt: T0, gps: { status: 'inside', remainingKm: 2 } }),
    )
    expect(gpsInside).toEqual({ state: 'zone', distance: 2, inZone: true })
  })

  it('UC-2g: GPS unknown で新しいフラグも無い → 前のゾーンの状態を保つ', () => {
    const prev = deriveAlertState(inputs({ gps: { status: 'inside', remainingKm: 6 } }))
    const kept = deriveAlertState(inputs({ gps: { status: 'unknown' }, previous: prev }))
    expect(kept).toEqual({ state: 'zone', distance: 6, inZone: true })
    const fresh = deriveAlertState(inputs({ gps: { status: 'unknown' }, previous: null }))
    expect(fresh).toEqual({ state: 'safe', distance: undefined, inZone: false })
  })

  it('UC-2h: フラグが 1 つも無い → GPS の出入りだけで safe / zone になり、danger にならない', () => {
    let prev = null
    for (const gps of [
      { status: 'outside' as const, distanceKm: 3 },
      { status: 'inside' as const, remainingKm: 10 },
      { status: 'unknown' as const },
      { status: 'outside' as const, distanceKm: 20 },
    ]) {
      prev = deriveAlertState(inputs({ gps, previous: prev }))
      expect(prev.state).not.toBe('danger')
    }
    expect(prev?.state).toBe('safe')
  })

  it('danger の距離が無い（壊れたフラグ）→ distance は undefined（表示は「--」）', () => {
    const { distanceM: _dropped, ...broken } = deer()
    const r = deriveAlertState(inputs({ flag: broken, flagReceivedAt: T0 }))
    expect(r).toMatchObject({ state: 'danger', distance: undefined })
  })
})

describe('resilience', () => {
  it('FAIL-5: 時計が後ろへ戻っても danger を早く解かない', () => {
    const r = deriveAlertState(inputs({ flag: deer(), flagReceivedAt: T0, now: T0 - 60_000 }))
    expect(r.state).toBe('danger')
  })
})
