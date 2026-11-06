import { describe, expect, it } from 'vitest'
import { NO_INPUT, type DriveInput, type Surface, type VehicleState } from '../types'
import {
  LANE_CENTER_D,
  MAX_SPEED_KMH,
  OFFROAD_LIMIT_M,
  OFFROAD_MAX_KMH,
  REVERSE_MAX_KMH,
  ROAD_EDGE_M,
  brakeDecel,
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

  // drive-tune で実測（JAF・パナソニック）に合わせた。drive-3d の 50 m・×1.3 / ×1.5 / ×2.0 は廃止
  it.each([
    ['dry', 7.9],
    ['wet', 11],
    ['packed-snow', 17.3],
    ['ice', 78.5],
  ] as const)(
    'UC-3b（drive-3d）/ UC-3a（drive-tune）: 40 km/h から Space で止まるまで（%s）は実測 %d m の ±10%%',
    (surface, measured) => {
      const distance = brakingDistance(surface, 40)
      expect(distance).toBeGreaterThan(measured * 0.9)
      expect(distance).toBeLessThan(measured * 1.1)
    },
  )

  it('UC-3b（drive-tune）: 60 km/h 乾燥で 18〜21 m。速いほど効きが弱い（100 km/h の減速度 < 40 km/h）', () => {
    const d60 = brakingDistance('dry', 60)
    expect(d60).toBeGreaterThan(18)
    expect(d60).toBeLessThan(21)
    for (const surface of ['dry', 'wet', 'packed-snow', 'ice'] as const) {
      expect(brakeDecel(surface, 100 / 3.6)).toBeLessThan(brakeDecel(surface, 40 / 3.6))
    }
    expect(brakeDecel('dry', 40 / 3.6)).toBeCloseTo(0.8 * 9.81, 6)
  })

  it('UC-3c（drive-tune）: 踏んでから 0.15 秒は減速度が立ち上がる途中', () => {
    const v0: VehicleState = { ...initialVehicle(100), speed: 60 / 3.6 }
    const first = stepVehicle(v0, { ...NO_INPUT, brake: true }, 'dry', DT)
    expect(first.brakeLevel).toBeCloseTo(DT / 0.15, 6)
    const halfway = run(v0, { brake: true }, 'dry', 0.075)
    expect(halfway.brakeLevel).toBeGreaterThan(0.4)
    expect(halfway.brakeLevel).toBeLessThan(0.6)
    expect(run(v0, { brake: true }, 'dry', 0.2).brakeLevel).toBe(1)
    expect(stepVehicle(first, NO_INPUT, 'dry', DT).brakeLevel).toBe(0)
  })

  it('UC-3d（drive-tune）: 湿潤・圧雪・凍結で 10 km/h 以上のブレーキ中は ABS が働き、ステアで横に動ける。乾燥では働かない', () => {
    for (const surface of ['wet', 'packed-snow', 'ice'] as const) {
      const v0: VehicleState = { ...initialVehicle(100), speed: 50 / 3.6 }
      const after = run(v0, { brake: true, right: true }, surface, 0.5)
      expect(after.abs).toBe(true)
      expect(after.d).toBeGreaterThan(v0.d + 0.1)
    }
    const dry = run({ ...initialVehicle(100), speed: 50 / 3.6 }, { brake: true }, 'dry', 0.5)
    expect(dry.abs).toBe(false)
    const slow = run({ ...initialVehicle(100), speed: 8 / 3.6 }, { brake: true }, 'ice', 0.05)
    expect(slow.abs).toBe(false)
  })

  it('UC-3e（drive-tune）: 走っている間の S の減速はブレーキの 6 割', () => {
    const v0: VehicleState = { ...initialVehicle(100), speed: 60 / 3.6 }
    const brake = run(v0, { brake: true }, 'dry', 0.5)
    const back = run(v0, { back: true }, 'dry', 0.5)
    expect(back.brakeLevel).toBeCloseTo(0.6, 6)
    const dropBrake = v0.speed - brake.speed
    const dropBack = v0.speed - back.speed
    expect(dropBack / dropBrake).toBeGreaterThan(0.5)
    expect(dropBack / dropBrake).toBeLessThan(0.7)
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
