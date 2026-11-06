import {
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  PlaneGeometry,
  Quaternion,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
} from 'three'
import { CABIN } from './palette'
import { merge, paint } from './mesh-utils'

// 右ハンドルの車内（自作のローポリ。R10・A3-1）。車の座標: 原点は車の中心の地面、-Z が前、+X が右。
// 運転者の目は layout.ts の DRIVER_EYE。ハンドルとメーターは右寄り、ナビは中央、スマホマウントはナビの上。

export type V3 = readonly [number, number, number]

/** ハンドルの中心と傾き（上が遠い） */
// drive-tune R5: 0.98 → 1.0（輪の上端がメーターの上の行（時計・気温）に掛からないように）
export const WHEEL_CENTER: V3 = [0.44, 1.0, -0.06]
export const WHEEL_TILT_RAD = -0.42
/**
 * メーター（drive-tune R5 の文字盤）の中心。運転者の目からハンドルの上の輪の内側に見える位置
 * （目 x 0.3 → ハンドル x 0.44 の延長で x 0.5）。下端はダッシュボードの上面（y 0.97）より上
 */
export const METER_CENTER: V3 = [0.5, 1.03, -0.3]
/** 文字盤の板の大きさ（m） */
export const METER_SIZE_M: readonly [number, number] = [0.3, 0.11]
/** ナビの画面の中心（中央のダッシュボード） */
export const NAV_CENTER: V3 = [0.08, 0.925, -0.24]
/** スマホ（ナビの上のマウント）の画面の中心と大きさ（m）。縦長 */
export const PHONE_CENTER: V3 = [0.1, 1.065, -0.3]
export const PHONE_SIZE_M: readonly [number, number] = [0.075, 0.15]
/** スマホは運転者の方へ回す（rad） */
export const PHONE_YAW_RAD = 0.3
export const PHONE_TILT_RAD = -0.12
/**
 * ルームミラー（drive-tune R5）の鏡の面の中心・大きさ（m）・向き。実車の大きさ（約 0.22 × 0.06 m）。
 * 面の向きは、運転者の目への向きと真後ろの間（右ハンドルなので右へ、少し下へ）
 */
export const MIRROR_CENTER: V3 = [0, 1.4, -0.36]
export const MIRROR_SIZE_M: readonly [number, number] = [0.21, 0.058]
export const MIRROR_YAW_RAD = 0.2
export const MIRROR_PITCH_RAD = 0.12

/** from から to へ伸びる細い角柱 */
function beam(from: V3, to: V3, radius: number, color: string): BufferGeometry {
  const a = new Vector3(...from)
  const b = new Vector3(...to)
  const dir = b.clone().sub(a)
  const geo = new CylinderGeometry(radius, radius, dir.length(), 4, 1, true)
  geo.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize()))
  const mid = a.add(b).multiplyScalar(0.5)
  geo.translate(mid.x, mid.y, mid.z)
  return paint(geo, color)
}

function box(size: V3, at: V3, color: string, rotX = 0): BufferGeometry {
  return paint(new BoxGeometry(...size).rotateX(rotX).translate(...at), color)
}

/** 動かない車内（ダッシュボード・計器のひさし・柱・屋根・ボンネット・ルームミラー・メーターの目盛り） */
export function buildCabinShell(): BufferGeometry {
  const parts: BufferGeometry[] = [
    // ダッシュボードの上面と前面
    box([1.66, 0.06, 0.62], [0, 0.94, -0.46], CABIN.dashTop),
    box([1.66, 0.42, 0.06], [0, 0.74, -0.16], CABIN.dash, 0.25),
    // 計器のひさしと文字盤の板（運転席の前）
    box(
      // 運転者の目から文字盤の上端が見えるよう、ひさしは短く高く（下端 y ≈ 1.12）
      [METER_SIZE_M[0] + 0.06, 0.03, 0.12],
      [METER_CENTER[0], METER_CENTER[1] + METER_SIZE_M[1] / 2 + 0.05, -0.3],
      CABIN.dashTop,
      -0.1,
    ),
    box(
      [METER_SIZE_M[0] + 0.02, METER_SIZE_M[1] + 0.02, 0.03],
      [METER_CENTER[0], METER_CENTER[1], METER_CENTER[2] - 0.02],
      CABIN.meterFace,
    ),
    // 中央のコンソール
    box([0.3, 0.34, 0.34], [0, 0.55, -0.02], CABIN.trim),
    // ナビの枠（画面は別）
    box(
      [0.27, 0.17, 0.03],
      [NAV_CENTER[0], NAV_CENTER[1], NAV_CENTER[2] - 0.016],
      CABIN.navFrame,
      -0.2,
    ),
    // スマホのマウント（ナビの上。吸盤の足と腕）
    beam(
      [PHONE_CENTER[0], 0.97, PHONE_CENTER[2] - 0.05],
      [PHONE_CENTER[0], PHONE_CENTER[1] - 0.04, PHONE_CENTER[2] - 0.02],
      0.012,
      CABIN.phoneMount,
    ),
    box([0.06, 0.012, 0.06], [PHONE_CENTER[0], 0.976, PHONE_CENTER[2] - 0.05], CABIN.phoneMount),
    // A ピラー・屋根の前端・屋根・ドアの上端
    beam([-0.8, 0.96, -0.74], [-0.67, 1.46, -0.04], 0.05, CABIN.pillar),
    beam([0.8, 0.96, -0.74], [0.67, 1.46, -0.04], 0.05, CABIN.pillar),
    beam([-0.68, 1.46, -0.04], [0.68, 1.46, -0.04], 0.055, CABIN.pillar),
    box([1.44, 0.03, 1.1], [0, 1.5, 0.5], CABIN.trim),
    beam([-0.82, 0.96, -0.74], [-0.82, 0.98, 0.9], 0.04, CABIN.trim),
    beam([0.82, 0.96, -0.74], [0.82, 0.98, 0.9], 0.04, CABIN.trim),
    // ルームミラーの腕と枠（鏡の面は RearMirror が後ろのカメラの映像を貼る）
    beam([0, 1.47, -0.3], [0, 1.425, -0.35], 0.01, CABIN.trim),
    paint(
      new BoxGeometry(MIRROR_SIZE_M[0] + 0.014, MIRROR_SIZE_M[1] + 0.012, 0.022)
        .translate(0, 0, -0.012)
        .rotateX(MIRROR_PITCH_RAD)
        .rotateY(MIRROR_YAW_RAD)
        .translate(...MIRROR_CENTER),
      CABIN.trim,
    ),
    // ボンネット（前へ少し下がる）
    box([1.6, 0.04, 1.45], [0, 0.86, -1.5], CABIN.hood, 0.07),
  ]
  // メーターの目盛りと数字は Dashboard の canvas が描く（drive-tune R5）
  return merge(parts)
}

/** ハンドル（原点は中心、輪は XY 面で +Z が運転者の方） */
export function buildWheel(): BufferGeometry {
  const parts: BufferGeometry[] = [
    paint(new TorusGeometry(0.17, 0.017, 5, 18), CABIN.wheel),
    paint(new CylinderGeometry(0.045, 0.05, 0.04, 8).rotateX(Math.PI / 2), CABIN.wheel),
  ]
  // 3 本スポーク（右・左・下）。上に無いので、輪の上の内側からメーターが見える
  for (const angle of [0, Math.PI, -Math.PI / 2]) {
    parts.push(
      paint(new BoxGeometry(0.16, 0.022, 0.012).translate(0.085, 0, 0).rotateZ(angle), CABIN.wheel),
    )
  }
  return merge(parts)
}

/** メーターの針（原点は文字盤の中心、+Y へ伸びる）と、中心の軸の蓋 */
export function buildNeedle(lengthM: number): BufferGeometry {
  return merge([
    paint(
      new BoxGeometry(0.003, lengthM, 0.002).translate(0, lengthM / 2 - 0.006, 0.003),
      CABIN.meterNeedle,
    ),
    paint(
      new CylinderGeometry(0.005, 0.005, 0.003, 10).rotateX(Math.PI / 2).translate(0, 0, 0.0045),
      CABIN.meterHub,
    ),
  ])
}

/** ナビの画面（地図の下地・水面・ルート線・自車の印。MeshBasic で光らせる） */
export function buildNavScreen(): BufferGeometry {
  const parts: BufferGeometry[] = [
    paint(new PlaneGeometry(0.25, 0.15), CABIN.navScreen),
    paint(
      new CircleGeometry(0.035, 8).scale(1.6, 1, 1).translate(-0.07, 0.04, 0.001),
      CABIN.navWater,
    ),
    paint(new PlaneGeometry(0.012, 0.16).rotateZ(0.25).translate(0.01, 0, 0.002), CABIN.navRoute),
    paint(
      new CircleGeometry(0.012, 3).rotateZ(Math.PI / 2).translate(0.006, -0.03, 0.003),
      CABIN.navCar,
    ),
  ]
  return merge(parts)
}

/**
 * ルームミラーの鏡の面（原点は面の中心、+Z が運転者の方）。後ろ向きのカメラの映像を貼るので、
 * u を 1 − u にして左右反転する（車の左後ろがミラーの左に映る）。投影行列は反転しない（面の裏表が逆になる）
 */
export function buildMirrorFace(): BufferGeometry {
  const geo = new PlaneGeometry(MIRROR_SIZE_M[0], MIRROR_SIZE_M[1])
  const uv = geo.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i))
  uv.needsUpdate = true
  return geo
}

/** スマホの本体（画面は Html を重ねる。原点は画面の中心、+Z が画面の向き） */
export function buildPhoneBody(): BufferGeometry {
  return merge([
    paint(
      new BoxGeometry(PHONE_SIZE_M[0] + 0.008, PHONE_SIZE_M[1] + 0.012, 0.009).translate(
        0,
        0,
        -0.005,
      ),
      CABIN.phoneBody,
    ),
  ])
}
