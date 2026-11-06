// ジャイロの視線（docs/specs/mobile-landscape/functional.md R4、A3-2）。
// 端末の向き（W3C の deviceorientation の alpha・beta・gamma）から、端末の背面が指す方角と仰角を求め、
// 最初の向き（基準）からのずれを視線の目標（look.ts の lookTarget に渡す -1〜1）にする。
// 背面の向きを回転行列で求めるので、縦持ち・横持ち（画面の向き 90° / -90°）のどれでも同じ式で済む。

import { LOOK_PITCH_MAX_DEG, LOOK_YAW_MAX_DEG } from './look'

/** 基準がいまの向きに寄る時定数（ms）。持ち方を変えても、しばらくすると正面に戻る */
export const GYRO_RECENTER_MS = 5000
/** これより背面が真上・真下に近いと方角が定まらない（方角のずれは前の値のまま） */
export const GYRO_MAX_ELEVATION_DEG = 70
/** これより長く向きが届かなければ、ジャイロを使わない（ポインタに戻る） */
export const GYRO_STALE_MS = 1000

const RAD = Math.PI / 180

export type DeviceDirection = {
  /** 背面が指す方角（度。alpha の基準から時計回りが正。0〜360） */
  headingDeg: number
  /** 背面の仰角（度。上が正、-90〜90） */
  elevationDeg: number
}

/**
 * alpha・beta・gamma（度）→ 背面（端末の -Z）の方角と仰角。
 * 回転は R = Rz(alpha)·Rx(beta)·Ry(gamma)（W3C）。背面の向き = R·(0, 0, -1)。
 */
export function deviceDirection(alpha: number, beta: number, gamma: number): DeviceDirection {
  const a = alpha * RAD
  const b = beta * RAD
  const g = gamma * RAD
  const [sa, ca, sb, cb, sg, cg] = [
    Math.sin(a),
    Math.cos(a),
    Math.sin(b),
    Math.cos(b),
    Math.sin(g),
    Math.cos(g),
  ]
  // 東 x・北 y・上 z
  const x = -ca * sg - sa * sb * cg
  const y = -sa * sg + ca * sb * cg
  const z = -cb * cg
  const heading = Math.atan2(x, y) / RAD
  return {
    headingDeg: (heading + 360) % 360,
    elevationDeg: Math.asin(Math.max(-1, Math.min(1, z))) / RAD,
  }
}

/** -180〜180 に包む */
function wrapDeg(d: number): number {
  return ((((d + 180) % 360) + 360) % 360) - 180
}

function clampUnit(v: number): number {
  return Math.min(1, Math.max(-1, v))
}

/** 向きを受け取り、基準からのずれを視線の目標（x: 右 1、y: 上 1）にする */
export class GyroLook {
  private base: DeviceDirection | null = null
  private yawDeg = 0
  private pitchDeg = 0
  private lastAt = -Infinity

  /** 向きを 1 つ受け取る（nowMs は単調な時計） */
  push(direction: DeviceDirection, nowMs: number): void {
    if (!this.base) {
      this.base = { ...direction }
      this.lastAt = nowMs
      this.yawDeg = 0
      this.pitchDeg = 0
      return
    }
    // 基準をいまの向きへ寄せる（指数関数。時間が戻っても進めない）
    const dt = Math.max(0, nowMs - this.lastAt)
    const k = 1 - Math.exp(-dt / GYRO_RECENTER_MS)
    const flat = Math.abs(direction.elevationDeg) > GYRO_MAX_ELEVATION_DEG
    if (!flat) {
      this.base.headingDeg += wrapDeg(direction.headingDeg - this.base.headingDeg) * k
      this.yawDeg = wrapDeg(direction.headingDeg - this.base.headingDeg)
    }
    this.base.elevationDeg += (direction.elevationDeg - this.base.elevationDeg) * k
    this.pitchDeg = direction.elevationDeg - this.base.elevationDeg
    this.lastAt = nowMs
  }

  /** 視線の目標（-1〜1）。向きが届いていない・途切れたら null */
  target(nowMs: number): { x: number; y: number } | null {
    if (!this.base || nowMs - this.lastAt > GYRO_STALE_MS) return null
    return {
      x: clampUnit(this.yawDeg / LOOK_YAW_MAX_DEG),
      y: clampUnit(this.pitchDeg / LOOK_PITCH_MAX_DEG),
    }
  }

  /** 聞くのをやめたとき。次に届いた向きが新しい基準 */
  clear(): void {
    this.base = null
    this.lastAt = -Infinity
    this.yawDeg = 0
    this.pitchDeg = 0
  }
}
