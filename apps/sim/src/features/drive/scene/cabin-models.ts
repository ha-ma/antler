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
export const WHEEL_CENTER: V3 = [0.44, 0.98, -0.06]
export const WHEEL_TILT_RAD = -0.42
/** メーター（速度）の文字盤の中心 */
export const METER_CENTER: V3 = [0.44, 0.985, -0.3]
/** ナビの画面の中心（中央のダッシュボード） */
export const NAV_CENTER: V3 = [0.08, 0.925, -0.24]
/** スマホ（ナビの上のマウント）の画面の中心と大きさ（m）。縦長 */
export const PHONE_CENTER: V3 = [0.1, 1.065, -0.3]
export const PHONE_SIZE_M: readonly [number, number] = [0.075, 0.15]
/** スマホは運転者の方へ回す（rad） */
export const PHONE_YAW_RAD = 0.3
export const PHONE_TILT_RAD = -0.12

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
    box([0.44, 0.04, 0.18], [METER_CENTER[0], 1.07, -0.26], CABIN.dashTop, -0.1),
    box(
      [0.4, 0.16, 0.03],
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
    // ルームミラー
    beam([0, 1.47, -0.32], [0, 1.42, -0.36], 0.01, CABIN.trim),
    box([0.16, 0.045, 0.02], [0, 1.41, -0.36], CABIN.trim),
    // ボンネット（前へ少し下がる）
    box([1.6, 0.04, 1.45], [0, 0.86, -1.5], CABIN.hood, 0.07),
  ]
  // メーターの目盛り（0〜120 km/h、20 km/h ごと）
  for (let k = 0; k <= 6; k++) {
    const angle = meterAngle(k * 20)
    const r = 0.06
    const x = METER_CENTER[0] - Math.sin(angle) * r
    const y = METER_CENTER[1] + Math.cos(angle) * r
    parts.push(
      paint(
        new BoxGeometry(0.004, 0.014, 0.004).rotateZ(angle).translate(x, y, METER_CENTER[2]),
        CABIN.meterTick,
      ),
    )
  }
  return merge(parts)
}

/** ハンドル（原点は中心、輪は XY 面で +Z が運転者の方） */
export function buildWheel(): BufferGeometry {
  const parts: BufferGeometry[] = [
    paint(new TorusGeometry(0.17, 0.017, 5, 18), CABIN.wheel),
    paint(new CylinderGeometry(0.045, 0.05, 0.04, 8).rotateX(Math.PI / 2), CABIN.wheel),
  ]
  for (const angle of [Math.PI / 2, -Math.PI / 2, Math.PI]) {
    parts.push(
      paint(new BoxGeometry(0.16, 0.022, 0.012).translate(0.085, 0, 0).rotateZ(angle), CABIN.wheel),
    )
  }
  return merge(parts)
}

/** メーターの針（原点は文字盤の中心、+Y へ伸びる） */
export function buildNeedle(): BufferGeometry {
  return merge([
    paint(new BoxGeometry(0.004, 0.058, 0.003).translate(0, 0.026, 0.004), CABIN.meterNeedle),
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

/** 速さ（km/h）→ 針の角度（rad、rotation.z。0 km/h で左下、120 km/h で右下） */
export function meterAngle(kmh: number): number {
  const t = Math.min(1, Math.max(0, kmh / 120))
  return 2.2 - t * 4.4
}
