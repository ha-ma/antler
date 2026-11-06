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
/** 重力加速度（m/s²） */
export const G = 9.81
/**
 * 路面の摩擦係数（40 km/h のとき。drive-tune R3。docs/changes/2026-11-06-a-local-feedback.md §2.3）。
 * ABS 付きの乗用車の実測の制動距離から μ = v²/(2gd) で逆算した値（ABS の効果は実測に含まれる）:
 * 乾燥 0.8（パナソニックの目安、60 km/h で 17.7 m）、湿潤 0.57（JAF 2013、40 km/h で 11 m）、
 * 圧雪 0.36・凍結 0.08（JAF 2017、スタッドレス、40 km/h で 17.3 m・78.5 m）
 */
export const SURFACE_MU: Record<Surface, number> = {
  dry: 0.8,
  wet: 0.57,
  'packed-snow': 0.36,
  ice: 0.08,
}
/** 速いほど効きが弱い: μ × (1 − MU_SPEED_SLOPE × (v − 40 km/h))、0.85〜1.05 倍に収める */
export const MU_SPEED_SLOPE = 0.0015
/** ブレーキを踏んでから減速度が立ち上がるまで（s） */
export const BRAKE_RISE_S = 0.15
/** S（走っている間の減速）はブレーキの何割か */
export const BACK_BRAKE_RATIO = 0.6
/** この速さ（km/h）以上のブレーキで、滑りやすい路面なら ABS が働く */
export const ABS_MIN_KMH = 10
/** ブレーキを踏みきったとき、横に使える摩擦がどれだけ減るか（摩擦円。spec-adversary M5） */
export const BRAKE_LATERAL_SHARE = 0.5
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
  return { s, d: LANE_CENTER_D, speed: 0, lateralSpeed: 0, brakeLevel: 0, abs: false }
}

/** 速さ v（m/s）のときの摩擦係数（速いほど少し下がる） */
export function frictionAt(surface: Surface, speedMps: number): number {
  const factor = 1 - MU_SPEED_SLOPE * (Math.abs(speedMps) * 3.6 - 40)
  return SURFACE_MU[surface] * Math.min(1.05, Math.max(0.85, factor))
}

/** 踏みきったときのブレーキの減速度（m/s²）= μ(v) × g */
export function brakeDecel(surface: Surface, speedMps: number): number {
  return frictionAt(surface, speedMps) * G
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
  const brakeLevel = nextBrakeLevel(v, input, dtS)
  const speed = nextSpeed(v, input, surface, brakeLevel, dtS)
  const { d, lateralSpeed } = nextLateral(v, input, surface, speed, brakeLevel, dtS)
  let s = v.s + speed * dtS
  let finalSpeed = speed
  // 始点より前へは下がれない（UC-3f）
  if (s < 0) {
    s = 0
    finalSpeed = Math.max(0, finalSpeed)
  }
  // 滑りやすい路面で、ある程度の速さでブレーキを踏んでいる間は ABS が働く（drive-tune UC-3d）。
  // 横の動き（ステア）はブレーキ中も効かせる（ABS がタイヤのロックを防ぐ）
  const abs = brakeLevel > 0 && surface !== 'dry' && Math.abs(v.speed) * 3.6 >= ABS_MIN_KMH
  return { s, d, speed: finalSpeed, lateralSpeed, brakeLevel, abs }
}

/**
 * ブレーキの強さ（0〜1）。Space は 1、走っている間の S は BACK_BRAKE_RATIO を目指し、
 * 踏んでから BRAKE_RISE_S で直線に立ち上がる。離したらすぐ 0（drive-tune UC-3c・UC-3e）
 */
function nextBrakeLevel(v: VehicleState, input: DriveInput, dtS: number): number {
  const forward = v.speed > kmh(STOPPED_KMH)
  const target = input.brake ? 1 : input.back && forward ? BACK_BRAKE_RATIO : 0
  if (target === 0) return 0
  return Math.min(target, v.brakeLevel + dtS / BRAKE_RISE_S)
}

function nextSpeed(
  v: VehicleState,
  input: DriveInput,
  surface: Surface,
  brakeLevel: number,
  dtS: number,
): number {
  const brake = brakeDecel(surface, v.speed)
  const grip = SURFACE_GRIP[surface]
  const max = kmh(MAX_SPEED_KMH)
  let speed = v.speed
  const forward = speed > kmh(STOPPED_KMH)
  const reversing = speed < -kmh(STOPPED_KMH)

  if (input.brake) {
    speed = towardZero(speed, brake * brakeLevel * dtS)
  } else if (input.throttle && !input.back) {
    if (reversing) speed = towardZero(speed, brake * dtS)
    else {
      // 圧雪・凍結では駆動輪が滑るぶん加速も鈍る（グリップの半分だけ効かせる）
      const traction = 0.5 + 0.5 * grip
      speed += THROTTLE_ACCEL * traction * (1 - 0.75 * (speed / max)) * dtS
    }
  } else if (input.back) {
    // 走っている間は減速（ブレーキの 6 割）、止まっていれば（または後退中なら）後退（UC-3c）
    if (forward) speed = towardZero(speed, brake * brakeLevel * dtS)
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
  brakeLevel: number,
  dtS: number,
): { d: number; lateralSpeed: number } {
  // 摩擦円: ブレーキに使っているぶん、横に使える摩擦が減る（踏みきりで半分。ABS でロックはしないので 0 にはならない）
  const grip = SURFACE_GRIP[surface] * (1 - BRAKE_LATERAL_SHARE * brakeLevel)
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
