import { describe, expect, it } from 'vitest'
import { LOOK_PITCH_MAX_DEG, LOOK_YAW_MAX_DEG, easeLook, lookTarget, type Look } from './look'

const deg = (rad: number) => (rad * 180) / Math.PI

describe('look（R10、A3-2）', () => {
  it('UC-10a: カーソルが右端・上端でヨー +12°・ピッチ +6°、中央で 0', () => {
    const corner = lookTarget(1, 1)
    expect(deg(corner.yaw)).toBeCloseTo(LOOK_YAW_MAX_DEG, 9)
    expect(deg(corner.pitch)).toBeCloseTo(LOOK_PITCH_MAX_DEG, 9)
    expect(LOOK_YAW_MAX_DEG).toBe(12)
    expect(LOOK_PITCH_MAX_DEG).toBe(6)
    const center = lookTarget(0, 0)
    expect(center.yaw).toBe(0)
    expect(center.pitch).toBe(0)
    const leftBottom = lookTarget(-1, -1)
    expect(deg(leftBottom.yaw)).toBeCloseTo(-12, 9)
    expect(deg(leftBottom.pitch)).toBeCloseTo(-6, 9)
  })

  it('UC-10a: 端を越えても制限を超えない（NaN は中央）', () => {
    const over = lookTarget(3.5, -9)
    expect(deg(over.yaw)).toBeCloseTo(12, 9)
    expect(deg(over.pitch)).toBeCloseTo(-6, 9)
    expect(lookTarget(Number.NaN, Number.NaN)).toEqual({ yaw: 0, pitch: 0 })
  })

  it('UC-10b: 視線は目標へイージングで近づき、1 フレームでは飛ばない', () => {
    const target = lookTarget(1, 1)
    let cur: Look = { yaw: 0, pitch: 0 }
    cur = easeLook(cur, target, 1 / 60)
    // 1 フレームでは目標の 15% も進まない
    expect(cur.yaw).toBeGreaterThan(0)
    expect(cur.yaw / target.yaw).toBeLessThan(0.15)
    // 0.5 秒で半分以上、1.5 秒でほぼ追いつく。行き過ぎない
    let maxYaw = 0
    for (let i = 1; i < 30; i++) {
      cur = easeLook(cur, target, 1 / 60)
      maxYaw = Math.max(maxYaw, cur.yaw)
    }
    expect(cur.yaw / target.yaw).toBeGreaterThan(0.5)
    for (let i = 0; i < 60; i++) {
      cur = easeLook(cur, target, 1 / 60)
      maxYaw = Math.max(maxYaw, cur.yaw)
    }
    expect(cur.yaw / target.yaw).toBeGreaterThan(0.97)
    expect(maxYaw).toBeLessThanOrEqual(target.yaw)
  })

  it('UC-10b: タブを戻したときの長いフレーム（2 秒）でも 1 回で飛ばない', () => {
    const target = lookTarget(1, 0)
    const cur = easeLook({ yaw: 0, pitch: 0 }, target, 2)
    expect(cur.yaw / target.yaw).toBeLessThan(0.5)
  })
})
