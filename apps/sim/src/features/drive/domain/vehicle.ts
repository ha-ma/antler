import type { DriveInput, Surface, VehicleState } from '../types'

// 簡易車両力学（R3、A3-4。ch9 ② A アーケード）。純粋関数で、固定ステップ（1/60 秒）で積分する前提。
// 縦: アクセル・惰性・ブレーキ（制動距離から逆算した一定の減速度）・後退。
// 横: 道の座標 d を直接動かす（車体の向きは常に道の向き）。ステアの効きは路面のグリップに比例し、
//     ステアを離すと左車線の中央へゆっくり戻る（吸着）。
// 関数の形（stepVehicle・initialVehicle）と定数の名前は simulation.ts が使うので変えない。

export const MAX_SPEED_KMH = 100
export const REVERSE_MAX_KMH = 20
/** 左車線の中央（中心線から左へ 1.75 m） */
export const LANE_CENTER_D = -1.75
/** 路肩の外側（中心線から左右に、m）。これより外は 30 km/h まで */
export const ROAD_EDGE_M = 4.5
export const OFFROAD_MAX_KMH = 30
/** これより外へは出られない（中心線から左右に、m） */
export const OFFROAD_LIMIT_M = 8
/** 60 km/h から乾燥路で止まるまでの距離（m） */
export const BRAKE_DISTANCE_60_M = 50
/** 路面ごとの制動距離の係数（推奨で決定） */
export const SURFACE_BRAKE_FACTOR: Record<Surface, number> = {
  dry: 1,
  wet: 1.3,
  'packed-snow': 1.5,
  ice: 2,
}
/** 路面ごとのグリップ（ステアで横に動く速さの係数。推奨で決定） */
export const SURFACE_GRIP: Record<Surface, number> = {
  dry: 1,
  wet: 0.85,
  'packed-snow': 0.7,
  ice: 0.5,
}
/** これ未満は「止まっている」（km/h） */
export const STOPPED_KMH = 0.5

/** アクセルの加速度（m/s²、0 km/h のとき。速くなるほど落ちる） */
const THROTTLE_ACCEL = 4.2
/** 惰性の減速（m/s²）＋速さに比例する分（1/s） */
const COAST_DECEL = 0.45
const COAST_DRAG = 0.012
/** 後退の加速度（m/s²） */
const REVERSE_ACCEL = 2.5
/** 路肩の外で 30 km/h まで落とす減速（m/s²。雪の路肩に突っ込む） */
const OFFROAD_DECEL = 9
/** ステアで横に動く速さ（m/s、乾燥・十分な速さのとき） */
const STEER_LATERAL_MPS = 2.6
/** 吸着の強さ（1/s）。車線の中央からのずれに掛けて横の速さにする */
const LANE_PULL = 0.7
/** 吸着で横に動く速さの上限（m/s） */
const LANE_PULL_MAX_MPS = 1.2
/** 横の速さが目標に追いつく時定数（s）。路面で変えない（グリップの比を正確に保つ） */
const LATERAL_RESPONSE_S = 0.12
/** この速さ（m/s）までは横に動く量を速さに比例して減らす（止まっていると横に動かない） */
const LATERAL_FULL_SPEED_MPS = 5

const kmh = (v: number) => v / 3.6

export function initialVehicle(s = 0): VehicleState {
  return { s, d: LANE_CENTER_D, speed: 0, lateralSpeed: 0 }
}

/** ブレーキの減速度（m/s²）。60 km/h から BRAKE_DISTANCE_60_M × 路面係数で止まる */
export function brakeDecel(surface: Surface): number {
  const v60 = kmh(60)
  return (v60 * v60) / (2 * BRAKE_DISTANCE_60_M * SURFACE_BRAKE_FACTOR[surface])
}

export function isStopped(v: Pick<VehicleState, 'speed'>): boolean {
  return Math.abs(v.speed) < kmh(STOPPED_KMH)
}

/** dtS 秒だけ進める（純粋関数） */
export function stepVehicle(
  v: VehicleState,
  input: DriveInput,
  surface: Surface,
  dtS: number,
): VehicleState {
  const speed = nextSpeed(v, input, surface, dtS)
  const { d, lateralSpeed } = nextLateral(v, input, surface, speed, dtS)
  let s = v.s + speed * dtS
  let finalSpeed = speed
  // 始点より前へは下がれない（UC-3f）
  if (s < 0) {
    s = 0
    finalSpeed = Math.max(0, finalSpeed)
  }
  return { s, d, speed: finalSpeed, lateralSpeed }
}

function nextSpeed(v: VehicleState, input: DriveInput, surface: Surface, dtS: number): number {
  const brake = brakeDecel(surface)
  const grip = SURFACE_GRIP[surface]
  const max = kmh(MAX_SPEED_KMH)
  let speed = v.speed
  const forward = speed > kmh(STOPPED_KMH)
  const reversing = speed < -kmh(STOPPED_KMH)

  if (input.brake) {
    speed = towardZero(speed, brake * dtS)
  } else if (input.throttle && !input.back) {
    if (reversing) speed = towardZero(speed, brake * dtS)
    else {
      // 圧雪・凍結では駆動輪が滑るぶん加速も鈍る（グリップの半分だけ効かせる）
      const traction = 0.5 + 0.5 * grip
      speed += THROTTLE_ACCEL * traction * (1 - 0.75 * (speed / max)) * dtS
    }
  } else if (input.back) {
    // 走っている間は減速、止まっていれば（または後退中なら）後退（UC-3c）
    if (forward) speed = towardZero(speed, brake * dtS)
    else speed -= REVERSE_ACCEL * dtS
  } else {
    speed = towardZero(speed, (COAST_DECEL + COAST_DRAG * Math.abs(speed)) * dtS)
  }

  // 路肩の外では 30 km/h へ強く落とす（UC-3d）
  const offroadMax = kmh(OFFROAD_MAX_KMH)
  if (Math.abs(v.d) > ROAD_EDGE_M && Math.abs(speed) > offroadMax) {
    const sign = Math.sign(speed)
    speed = sign * Math.max(offroadMax, Math.abs(speed) - OFFROAD_DECEL * dtS)
  }

  speed = Math.min(max, Math.max(-kmh(REVERSE_MAX_KMH), speed))
  // 0.5 km/h 未満でアクセルも後退も押していなければ止める（ふらつきを残さない）
  if (Math.abs(speed) < kmh(STOPPED_KMH) && !input.throttle && !input.back) speed = 0
  return speed
}

function nextLateral(
  v: VehicleState,
  input: DriveInput,
  surface: Surface,
  speed: number,
  dtS: number,
): { d: number; lateralSpeed: number } {
  const grip = SURFACE_GRIP[surface]
  const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0)
  const target =
    steer !== 0
      ? steer * STEER_LATERAL_MPS * grip
      : clamp((LANE_CENTER_D - v.d) * LANE_PULL, -LANE_PULL_MAX_MPS, LANE_PULL_MAX_MPS) * grip
  const k = 1 - Math.exp(-dtS / LATERAL_RESPONSE_S)
  let lateralSpeed = v.lateralSpeed + (target - v.lateralSpeed) * k
  const speedGate = Math.min(1, Math.abs(speed) / LATERAL_FULL_SPEED_MPS)
  let d = v.d + lateralSpeed * speedGate * dtS
  if (Math.abs(d) > OFFROAD_LIMIT_M) {
    d = Math.sign(d) * OFFROAD_LIMIT_M
    lateralSpeed = 0
  }
  return { d, lateralSpeed }
}

function towardZero(x: number, amount: number): number {
  if (Math.abs(x) <= amount) return 0
  return x - Math.sign(x) * amount
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}
