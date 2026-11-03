import type { Deer } from '../types'

// 鹿の目の反射（タペータム、ch9 ②）。薄暮では最初に見える手がかり。
// 強さ = 光の円錐の中の度合い（ライトの向き・鹿の目への向きの内積）× 鹿が光の方を向いている度合い（内積）× 距離。
// 背を向けると 0。純粋関数で、描画（scene/）は毎フレームこれを emissive の強さにする。

export type Vec2 = readonly [number, number]
/** 位置と向き（単位ベクトルでなくてよい） */
export type Ray = { pos: Vec2; dir: Vec2 }

/** ヘッドライトの円錐の半角（度）。これより外は照らさない */
export const BEAM_HALF_DEG = 30
/** この距離（m）までは弱まらず、EYESHINE_MAX_M で 0 */
export const EYESHINE_FULL_M = 70
export const EYESHINE_MAX_M = 170
/** 首が体の向きから回る限度（度） */
export const NECK_MAX_DEG = 100
/** 体の中心から目までの前への距離（m） */
const EYE_FORWARD_M = 0.75
/** 車の中心からヘッドライトまで（m、車長 4.4 m の前端） */
const HEADLIGHT_FORWARD_M = 2.2

const COS_EDGE = Math.cos((BEAM_HALF_DEG * Math.PI) / 180)

/** 0〜1 の強さ */
export function eyeshineStrength(light: Ray, eye: Ray): number {
  const toEye: Vec2 = [eye.pos[0] - light.pos[0], eye.pos[1] - light.pos[1]]
  const dist = Math.hypot(toEye[0], toEye[1])
  if (dist < 1e-6 || dist >= EYESHINE_MAX_M) return 0
  const lightDir = unit(light.dir)
  const eyeDir = unit(eye.dir)
  // ライトの向きと鹿の目への向きの内積（円錐の端で 0、真正面で 1）
  const cosBeam = (lightDir[0] * toEye[0] + lightDir[1] * toEye[1]) / dist
  const beam = Math.max(0, (cosBeam - COS_EDGE) / (1 - COS_EDGE))
  // 鹿の目の向きと、目からライトへの向きの内積（背を向けると 0）
  const facing = Math.max(0, -(eyeDir[0] * toEye[0] + eyeDir[1] * toEye[1]) / dist)
  const range =
    dist <= EYESHINE_FULL_M ? 1 : 1 - (dist - EYESHINE_FULL_M) / (EYESHINE_MAX_M - EYESHINE_FULL_M)
  return Math.min(1, Math.max(0, beam * facing * range))
}

/**
 * 目（顔）の向き（道の向きからの角度、rad）。顔を上げている（look）鹿は首を車の方へ回す（体から ±100° まで）。
 * scene/ は頭の回転にも使う
 */
export function gazeHeading(
  deer: Pick<Deer, 's' | 'd' | 'heading' | 'pose'>,
  carS: number,
  carD: number,
): number {
  if (deer.pose !== 'look') return deer.heading
  const toCar = Math.atan2(carD - deer.d, carS - deer.s)
  const turn = wrap(toCar - deer.heading)
  const limit = (NECK_MAX_DEG * Math.PI) / 180
  return deer.heading + Math.max(-limit, Math.min(limit, turn))
}

/** 道の座標（s 前・d 右）で求める。車は常に道の向き（ライトは (1, 0)）。道の曲がりは 170 m では無視する */
export function deerEyeshine(
  deer: Pick<Deer, 's' | 'd' | 'heading' | 'pose'>,
  carS: number,
  carD: number,
): number {
  const gaze = gazeHeading(deer, carS, carD)
  const eyeDir: Vec2 = [Math.cos(gaze), Math.sin(gaze)]
  return eyeshineStrength(
    { pos: [carS + HEADLIGHT_FORWARD_M, carD], dir: [1, 0] },
    {
      pos: [
        deer.s + Math.cos(deer.heading) * EYE_FORWARD_M,
        deer.d + Math.sin(deer.heading) * EYE_FORWARD_M,
      ],
      dir: eyeDir,
    },
  )
}

function unit(v: Vec2): Vec2 {
  const len = Math.hypot(v[0], v[1])
  return len === 0 ? [1, 0] : [v[0] / len, v[1] / len]
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}
