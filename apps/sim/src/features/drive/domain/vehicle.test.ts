import { describe, expect, it } from 'vitest'
import { NO_INPUT, type DriveInput, type Surface, type VehicleState } from '../types'
import {
  LANE_CENTER_D,
  MAX_SPEED_KMH,
  OFFROAD_LIMIT_M,
  OFFROAD_MAX_KMH,
  REVERSE_MAX_KMH,
  ROAD_EDGE_M,
  initialVehicle,
  isStopped,
  stepVehicle,
} from './vehicle'

const DT = 1 / 60
const kmh = (mps: number) => mps * 3.6

function run(
  v: VehicleState,
  input: Partial<DriveInput>,
  surface: Surface,
  seconds: number,
  each?: (v: VehicleState) => void,
): VehicleState {
  let cur = v
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) {
    cur = stepVehicle(cur, { ...NO_INPUT, ...input }, surface, DT)
    each?.(cur)
  }
  return cur
}

/** 速さ v0（km/h）から Space で止まるまでの距離（m） */
function brakingDistance(surface: Surface, v0Kmh = 60): number {
  let v: VehicleState = { ...initialVehicle(100), speed: v0Kmh / 3.6 }
  const start = v.s
  for (let i = 0; i < 60 * 30 && !isStopped(v); i++) {
    v = stepVehicle(v, { ...NO_INPUT, brake: true }, surface, DT)
  }
  expect(isStopped(v)).toBe(true)
  return v.s - start
}

describe('vehicle（R3）', () => {
  it('UC-3a: W を押し続けると 100 km/h で頭打ち。離すとゆるく減速する', () => {
    let top = 0
    const v = run(initialVehicle(0), { throttle: true }, 'dry', 40, (x) => {
      top = Math.max(top, x.speed)
    })
    expect(kmh(top)).toBeLessThanOrEqual(MAX_SPEED_KMH + 1e-9)
    expect(kmh(v.speed)).toBeGreaterThan(MAX_SPEED_KMH - 0.5)
    // アーケードらしく 0→60 km/h は 6 秒以内
    const after6 = run(initialVehicle(0), { throttle: true }, 'dry', 6)
    expect(kmh(after6.speed)).toBeGreaterThanOrEqual(60)
    // 離すと 1 秒で 1〜6 km/h だけ落ちる（ブレーキよりずっとゆるい）
    const coast = run(v, {}, 'dry', 1)
    const drop = kmh(v.speed - coast.speed)
    expect(drop).toBeGreaterThan(1)
    expect(drop).toBeLessThan(6)
  })

  it.each([
    ['dry', 50],
    ['wet', 65],
    ['packed-snow', 75],
    ['ice', 100],
  ] as const)('UC-3b: 60 km/h から Space で止まるまで（%s）は %d m ±5%%', (surface, expected) => {
    const distance = brakingDistance(surface)
    expect(distance).toBeGreaterThan(expected * 0.95)
    expect(distance).toBeLessThan(expected * 1.05)
  })

  it('UC-3c: 止まっているときに S で後退し、20 km/h で頭打ち。走っている間の S は減速', () => {
    let low = 0
    const v = run(initialVehicle(500), { back: true }, 'dry', 20, (x) => {
      low = Math.min(low, x.speed)
    })
    expect(v.speed).toBeLessThan(0)
    expect(kmh(-low)).toBeLessThanOrEqual(REVERSE_MAX_KMH + 1e-9)
    expect(kmh(-v.speed)).toBeGreaterThan(REVERSE_MAX_KMH - 0.5)

    // 60 km/h で S を押すと、まず減速する（すぐには後退しない）
    const moving: VehicleState = { ...initialVehicle(100), speed: 60 / 3.6 }
    const after = run(moving, { back: true }, 'dry', 0.5)
    expect(after.speed).toBeGreaterThan(0)
    expect(after.speed).toBeLessThan(moving.speed)
  })

  it('UC-3d: ステアを離すと左車線の中央へ戻る', () => {
    const start: VehicleState = { ...initialVehicle(100), d: 1.5, speed: 50 / 3.6 }
    const v = run(start, { throttle: true }, 'dry', 12)
    expect(Math.abs(v.d - LANE_CENTER_D)).toBeLessThan(0.1)
    // ゆっくり: 1 フレームでは 5 cm も動かない
    const one = stepVehicle(start, NO_INPUT, 'dry', DT)
    expect(Math.abs(one.d - start.d)).toBeLessThan(0.05)
  })

  it('UC-3d: 路肩より外では 30 km/h を超えず、8 m より外へ出ない', () => {
    // 路肩の外から 0 km/h でアクセルを踏み続けても 30 km/h を超えない
    let top = 0
    const off: VehicleState = { ...initialVehicle(100), d: -6 }
    run(off, { throttle: true, left: true }, 'dry', 15, (x) => {
      if (Math.abs(x.d) > ROAD_EDGE_M) top = Math.max(top, x.speed)
    })
    expect(kmh(top)).toBeLessThanOrEqual(OFFROAD_MAX_KMH + 1e-9)

    // 100 km/h で路肩の外へ出ると 3 秒以内に 30 km/h まで落ちる
    const fast: VehicleState = { ...initialVehicle(100), d: -5, speed: 100 / 3.6 }
    const slowed = run(fast, { throttle: true, left: true }, 'dry', 3)
    expect(kmh(slowed.speed)).toBeLessThanOrEqual(OFFROAD_MAX_KMH + 1e-9)

    // 左右どちらにステアし続けても |d| ≤ 8
    let widest = 0
    for (const side of ['left', 'right'] as const) {
      run(
        { ...initialVehicle(100), speed: 60 / 3.6 },
        { throttle: true, [side]: true },
        'dry',
        20,
        (x) => {
          widest = Math.max(widest, Math.abs(x.d))
        },
      )
    }
    expect(widest).toBeLessThanOrEqual(OFFROAD_LIMIT_M)
    expect(widest).toBeGreaterThan(OFFROAD_LIMIT_M - 0.01)
  })

  it('UC-3e: 同じステアを 1 秒続けると、圧雪は乾燥の 0.7 倍、凍結は 0.5 倍しか横に動かない', () => {
    const lateral = (surface: Surface) => {
      const start: VehicleState = { ...initialVehicle(100), speed: 60 / 3.6 }
      // ブレーキもアクセルも押さず、速さの差を小さく保つ（横の量は速さが 5 m/s 以上なら速さに依らない）
      const v = run(start, { right: true }, surface, 1)
      return v.d - start.d
    }
    const dry = lateral('dry')
    expect(dry).toBeGreaterThan(1)
    expect(lateral('packed-snow') / dry).toBeCloseTo(0.7, 3)
    expect(lateral('ice') / dry).toBeCloseTo(0.5, 3)
  })

  it('UC-3f: 後退で始点（s = 0）より前に出ない', () => {
    let lowest = Number.POSITIVE_INFINITY
    const v = run(initialVehicle(3), { back: true }, 'dry', 10, (x) => {
      lowest = Math.min(lowest, x.s)
    })
    expect(lowest).toBeGreaterThanOrEqual(0)
    expect(v.s).toBe(0)
    expect(v.speed).toBeGreaterThanOrEqual(0)
  })

  it('UC-3c: 0.5 km/h 未満は止まっている（入力が無ければ速さは 0 になる）', () => {
    const creeping: VehicleState = { ...initialVehicle(10), speed: 0.4 / 3.6 }
    expect(isStopped(creeping)).toBe(true)
    expect(stepVehicle(creeping, NO_INPUT, 'dry', DT).speed).toBe(0)
  })
})
