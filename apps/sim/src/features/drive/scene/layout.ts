import type { Deer } from '../types'
import { poseAt, type RoadFrame, type RoadPose } from '../domain/road'

// シーンの寸法と、道の座標 → 3D の置き方（描画だけで使う。真値は domain/ の (s, d)）。
// 車の座標系: 原点は車の中心の地面、-Z が前、+X が右（three.js の rotation.y = 道の yaw でそうなる）。

/** 運転者の目（車の座標、m）。右ハンドルなので右の席。車の中心より少し後ろ */
export const DRIVER_EYE: readonly [number, number, number] = [0.3, 1.24, 0.35]
/** 視線を少し下げる（rad）。路面と計器が見えるように */
export const EYE_DOWN_RAD = 0.02
export const CAMERA_FOV_DEG = 62
export const CAMERA_NEAR_M = 0.08
export const CAMERA_FAR_M = 1400

/** 道路をまとめる区間の長さ（m）と、横断面を刻む間隔（m） */
export const ROAD_CHUNK_M = 400
export const ROAD_SAMPLE_M = 5
/** 車の後ろ・前にどこまで描くか（m）。前はフォグの far（最大 650 m）より少し先まで */
export const DRAW_BEHIND_M = 80
export const DRAW_AHEAD_M = 720

/** 道路の横断面（中心線から片側、m） */
export const LANE_EDGE_M = 3.5
export const SHOULDER_EDGE_M = 4.6
export const BANK_TOP_M = 6.0
export const BANK_OUT_M = 8.5
export const BANK_HEIGHT_M = 0.55

/** 中心線からの横の位置 d の地面の高さ（除雪の雪の壁を越える鹿の足を沈めない） */
export function terrainHeight(d: number): number {
  const a = Math.abs(d)
  if (a <= SHOULDER_EDGE_M || a >= BANK_OUT_M) return 0
  if (a <= BANK_TOP_M)
    return (BANK_HEIGHT_M * (a - SHOULDER_EDGE_M)) / (BANK_TOP_M - SHOULDER_EDGE_M)
  return (BANK_HEIGHT_M * (BANK_OUT_M - a)) / (BANK_OUT_M - BANK_TOP_M)
}

/** 道のり s の区間の番号 */
export function chunkOf(s: number): number {
  return Math.max(0, Math.floor(s / ROAD_CHUNK_M))
}

/** 車の道のり carS から見て描く区間の番号の範囲（両端を含む） */
export function visibleChunks(carS: number, lengthM: number): [number, number] {
  const last = chunkOf(Math.max(0, lengthM - 1e-6))
  return [chunkOf(carS - DRAW_BEHIND_M), Math.min(last, chunkOf(carS + DRAW_AHEAD_M))]
}

/** 車の座標（-Z が前、+X が右）の点 → 平面の位置 */
export function carToWorld(
  car: Pick<RoadPose, 'x' | 'z' | 'forward' | 'right'>,
  local: readonly [number, number, number],
): [number, number, number] {
  const [lx, ly, lz] = local
  return [
    car.x + car.right[0] * lx - car.forward[0] * lz,
    ly,
    car.z + car.right[1] * lx - car.forward[1] * lz,
  ]
}

/** 鹿の 3D の置き方。yaw は three.js の rotation.y（道の向きから heading だけ右へ回す） */
export function deerPlacement(
  frame: RoadFrame,
  deer: Pick<Deer, 's' | 'd' | 'heading'>,
): { x: number; y: number; z: number; yaw: number } {
  const pose = poseAt(frame, deer.s, deer.d)
  return { x: pose.x, y: terrainHeight(deer.d), z: pose.z, yaw: pose.yaw - deer.heading }
}
