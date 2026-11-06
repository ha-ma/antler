import { tokens } from '@antler/alert-ui'
import type { DashboardText } from './dashboard-text'
import { METER_SIZE_M } from './cabin-models'
import { CLUSTER } from './palette'

// メーターの文字盤（drive-tune R5）を 2D canvas に描く。文字・目盛り・ABS の灯・ナビの案内は canvas、
// 針（速度・回転）は 3D のメッシュで毎フレーム回す（canvas は表示の文字が変わったときだけ描き直す）。
// 板は 0.30 × 0.11 m。左に回転計、右に速度計、真ん中に時計・外気温・ギア・ABS・ナビの案内。
// ハンドルの輪の上の内側から見るので、上の左右の角は輪に隠れる。読ませたい文字は真ん中の列と文字盤の下半分に置く。

/** 板の大きさ（m） */
export const CLUSTER_SIZE_M = METER_SIZE_M
/** canvas の大きさ（px）。板と同じ縦横比（1 px = 1/3 mm） */
export const CLUSTER_PX: readonly [number, number] = [900, 330]

/** 文字盤（回転計・速度計）の中心（px）と半径（px） */
export const TACH_DIAL = { cx: 148, cy: 178, r: 124 } as const
export const SPEED_DIAL = { cx: 752, cy: 178, r: 124 } as const
/** 針の長さ（m）。文字盤の半径より少し短く */
export const NEEDLE_M = (SPEED_DIAL.r - 14) * (METER_SIZE_M[0] / CLUSTER_PX[0])

export const SPEED_MAX_KMH = 120
export const RPM_MAX = 6000

/** 針の振れ（rotation.z、rad）。0 で左下、最大で右下（drive-3d の meterAngle と同じ 220° の弧） */
function sweep(t: number): number {
  return 2.2 - Math.min(1, Math.max(0, t)) * 4.4
}
export function speedAngle(kmh: number): number {
  return sweep(Math.abs(kmh) / SPEED_MAX_KMH)
}
export function rpmAngle(rpm: number): number {
  return sweep(rpm / RPM_MAX)
}

/** canvas の px → 板の上の位置（m、板の中心が原点、+Y が上） */
export function clusterPxToM(x: number, y: number): [number, number] {
  const k = CLUSTER_SIZE_M[0] / CLUSTER_PX[0]
  return [(x - CLUSTER_PX[0] / 2) * k, (CLUSTER_PX[1] / 2 - y) * k]
}

/** 描くのに使う 2D の文脈の一部（テストは記録するだけの偽物を渡す） */
export type Painter2D = Pick<
  CanvasRenderingContext2D,
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'font'
  | 'textAlign'
  | 'textBaseline'
  | 'clearRect'
  | 'fillRect'
  | 'beginPath'
  | 'closePath'
  | 'moveTo'
  | 'lineTo'
  | 'arc'
  | 'stroke'
  | 'fill'
  | 'roundRect'
  | 'fillText'
  | 'measureText'
>

const MONO = tokens.font.mono
const SANS = tokens.font.sans

/** 弧の上の点（canvas は y が下向き。angle は 3D の rotation.z と同じ向き） */
function onDial(cx: number, cy: number, r: number, angle: number): [number, number] {
  return [cx - Math.sin(angle) * r, cy - Math.cos(angle) * r]
}

/** 幅 maxW に収まるまで文字を小さくして描く */
function fitText(
  ctx: Painter2D,
  text: string,
  x: number,
  y: number,
  size: number,
  family: string,
  weight: number,
  maxW: number,
): void {
  ctx.font = `${weight} ${size}px ${family}`
  const w = ctx.measureText(text).width
  if (w > maxW) ctx.font = `${weight} ${Math.floor((size * maxW) / w)}px ${family}`
  ctx.fillText(text, x, y)
}

type Dial = { cx: number; cy: number; r: number }

function paintDial(
  ctx: Painter2D,
  dial: Dial,
  steps: number,
  minorPerStep: number,
  label: (k: number) => string,
  high: (k: number) => boolean,
): void {
  const { cx, cy, r } = dial
  // 外の輪
  ctx.strokeStyle = CLUSTER.ring
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()
  // 目盛り（大は数字つき）
  const total = steps * minorPerStep
  for (let i = 0; i <= total; i++) {
    const major = i % minorPerStep === 0
    const k = i / minorPerStep
    const a = sweep(i / total)
    const [x0, y0] = onDial(cx, cy, r - 6, a)
    const [x1, y1] = onDial(cx, cy, r - (major ? 26 : 16), a)
    ctx.strokeStyle = high(k) ? CLUSTER.tickHigh : CLUSTER.tick
    ctx.lineWidth = major ? 6 : 3
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
    if (major) {
      const [tx, ty] = onDial(cx, cy, r - 48, a)
      ctx.fillStyle = high(k) ? CLUSTER.tickHigh : CLUSTER.label
      ctx.font = `600 25px ${MONO}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label(k), tx, ty)
    }
  }
}

/** 文字盤を描く（背景から全部描き直す） */
export function paintCluster(ctx: Painter2D, t: DashboardText): void {
  const [W, H] = CLUSTER_PX
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = CLUSTER.face
  ctx.fillRect(0, 0, W, H)

  // 回転計（0〜6 × 1000 r/min）。5 以上は注意の色
  paintDial(
    ctx,
    TACH_DIAL,
    6,
    2,
    (k) => String(k),
    (k) => k >= 5,
  )
  ctx.fillStyle = CLUSTER.label
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `500 17px ${MONO}`
  ctx.fillText('×1000 r/min', TACH_DIAL.cx, TACH_DIAL.cy + 70)

  // 速度計（0〜120 km/h）と、数字の速さ
  paintDial(
    ctx,
    SPEED_DIAL,
    6,
    2,
    (k) => String(k * 20),
    () => false,
  )
  ctx.fillStyle = CLUSTER.text
  ctx.font = `700 54px ${MONO}`
  ctx.fillText(t.speed, SPEED_DIAL.cx, SPEED_DIAL.cy + 50)
  ctx.fillStyle = CLUSTER.label
  ctx.font = `500 18px ${MONO}`
  ctx.fillText('km/h', SPEED_DIAL.cx, SPEED_DIAL.cy + 88)

  // 真ん中の列（x 290〜610）
  const left = 290
  const right = 610
  const mid = (left + right) / 2
  // 時計（左）と外気温（右）
  ctx.fillStyle = CLUSTER.text
  ctx.textBaseline = 'middle'
  ctx.font = `600 34px ${MONO}`
  ctx.textAlign = 'left'
  ctx.fillText(t.clock, left, 44)
  ctx.textAlign = 'right'
  ctx.fillText(t.temp, right, 44)
  // 区切り線
  ctx.strokeStyle = CLUSTER.ring
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(left, 76)
  ctx.lineTo(right, 76)
  ctx.stroke()

  // ギア（大きく）
  ctx.fillStyle = CLUSTER.text
  ctx.textAlign = 'center'
  ctx.font = `700 92px ${MONO}`
  ctx.fillText(t.gear, mid + 40, 146)

  // ABS の灯（abs のときだけ点ける。消えているときは縁だけ）
  const lamp = { x: left, y: 122, w: 86, h: 48 }
  ctx.beginPath()
  ctx.roundRect(lamp.x, lamp.y, lamp.w, lamp.h, 10)
  if (t.abs) {
    ctx.fillStyle = CLUSTER.absOn
    ctx.fill()
  } else {
    ctx.strokeStyle = CLUSTER.absOff
    ctx.lineWidth = 3
    ctx.stroke()
  }
  ctx.fillStyle = t.abs ? CLUSTER.onAbs : CLUSTER.absOff
  ctx.font = `700 26px ${MONO}`
  ctx.textAlign = 'center'
  ctx.fillText('ABS', lamp.x + lamp.w / 2, lamp.y + lamp.h / 2 + 1)

  // ナビの次の案内（帯）
  ctx.fillStyle = CLUSTER.navBand
  ctx.beginPath()
  ctx.roundRect(left - 6, 210, right - left + 12, 66, 12)
  ctx.fill()
  ctx.fillStyle = CLUSTER.navText
  ctx.textAlign = 'center'
  fitText(ctx, t.nav, mid, 244, 32, SANS, 700, right - left - 16)
}
