import { between, createRng, deriveSeed, type Rng } from '../domain/rng'

// 降るもの（雪の粒・雨の筋）の動き（drive-season UC-3e）。描画（Precipitation.tsx）と分けてテストする。
// 粒は「車の座標」（原点は運転者の目、-Z が前、+X が右、+Y が上）の箱の中で持つ。毎フレーム、落ちる速さで下へ、
// 車の速さで後ろ（+Z）へ流し、箱を出たら反対の面へ巻き戻す。箱は車に付いて動くので 100 km/h でも途切れない。
// 乱数はシード付き（R13）。巻き戻すときに横と高さを振り直して、同じ列が繰り返し見えないようにする。

export type PrecipKind = 'snow' | 'rain'

/** 粒の数の上限（R6。雪 2,000・雨 1,500 以下） */
export const PRECIP_MAX: Record<PrecipKind, number> = { snow: 2000, rain: 1500 }

/** 箱の範囲（車の座標、m）。z は前（負）から後ろ（正）。目の高さ 1.24 m なので y = -1.3 が地面の少し下 */
export type PrecipBox = { x: [number, number]; y: [number, number]; z: [number, number] }
export const PRECIP_BOX: Record<PrecipKind, PrecipBox> = {
  snow: { x: [-18, 18], y: [-1.3, 13], z: [-45, 3] },
  rain: { x: [-15, 15], y: [-1.3, 11], z: [-36, 3] },
}

/** 落ちる速さ（m/s）。雪は揺れながらゆっくり、雨は速い */
const FALL: Record<PrecipKind, [number, number]> = { snow: [0.9, 1.5], rain: [8, 10] }
/** 雪の横の揺れ（m/s）と周期（rad/s） */
const SNOW_SWAY_MPS = 0.35
const SNOW_SWAY_RAD_S = 1.3
/** 雨の筋の長さ（m）の範囲。止まっているときの長さで、車が走ると相対の速さの向きに伸びる */
const RAIN_LEN_M: [number, number] = [0.45, 0.8]
/** 車内（運転者の目からの箱、m）。ここに入った粒は描かない（車内に雪が降らないように） */
const CABIN = { x: 1.05, yLow: -1.3, yHigh: 0.4, zFront: -2.6, zRear: 2.2 }
/** 描かない粒の置き場所（地面の下。地面の板に隠れる） */
const HIDDEN_Y = -50

export type PrecipField = {
  kind: PrecipKind
  count: number
  box: PrecipBox
  /** 位置（x, y, z を count 個） */
  pos: Float64Array
  /** 落ちる速さ（m/s） */
  fall: Float32Array
  /** 揺れの位相（雪）・筋の長さ（雨） */
  extra: Float32Array
  rng: Rng
  t: number
}

export function createPrecipField(
  kind: PrecipKind,
  seed: number,
  count = PRECIP_MAX[kind],
): PrecipField {
  const n = Math.min(count, PRECIP_MAX[kind])
  const rng = createRng(deriveSeed(seed, `precip-${kind}`))
  const box = PRECIP_BOX[kind]
  const pos = new Float64Array(n * 3)
  const fall = new Float32Array(n)
  const extra = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    pos[i * 3] = between(rng, box.x[0], box.x[1])
    pos[i * 3 + 1] = between(rng, box.y[0], box.y[1])
    pos[i * 3 + 2] = between(rng, box.z[0], box.z[1])
    fall[i] = between(rng, FALL[kind][0], FALL[kind][1])
    extra[i] = kind === 'snow' ? between(rng, 0, Math.PI * 2) : between(rng, ...RAIN_LEN_M)
  }
  return { kind, count: n, box, pos, fall, extra, rng, t: 0 }
}

/** v を [lo, hi) へ巻き戻す */
function wrap(v: number, lo: number, hi: number): number {
  const size = hi - lo
  return lo + ((((v - lo) % size) + size) % size)
}

/**
 * dtS 秒進める（落ちる・揺れる）。advanceM はこの間に車が進んだ道のり（m、前が正）で、粒は車から見てそのぶん後ろへ流れる
 * （再生速度を上げても箱が車に付いていく。大きく飛んでも箱の中へ巻き戻す）
 */
export function stepPrecipField(f: PrecipField, dtS: number, advanceM: number): void {
  const dt = Math.min(Math.max(dtS, 0), 0.1)
  f.t += dt
  const { box, pos, fall, extra, rng } = f
  for (let i = 0; i < f.count; i++) {
    const ix = i * 3
    let x = pos[ix] ?? 0
    let y = (pos[ix + 1] ?? 0) - (fall[i] ?? 0) * dt
    let z = (pos[ix + 2] ?? 0) + advanceM
    if (f.kind === 'snow')
      x += Math.sin(f.t * SNOW_SWAY_RAD_S + (extra[i] ?? 0)) * SNOW_SWAY_MPS * dt
    const outZ = z < box.z[0] || z >= box.z[1]
    const outY = y < box.y[0] || y >= box.y[1]
    if (outZ) {
      // 前後の面から出た: 反対の面へ。横と高さは振り直す
      z = wrap(z, box.z[0], box.z[1])
      x = between(rng, box.x[0], box.x[1])
      y = between(rng, box.y[0], box.y[1])
    } else if (outY) {
      // 地面に着いた: 上の面へ。横と前後は振り直す（同じ所に同じ粒が落ち続けないように）
      y = wrap(y, box.y[0], box.y[1])
      x = between(rng, box.x[0], box.x[1])
      z = between(rng, box.z[0], box.z[1])
    }
    pos[ix] = wrap(x, box.x[0], box.x[1])
    pos[ix + 1] = y
    pos[ix + 2] = z
  }
}

export function insideCabin(x: number, y: number, z: number): boolean {
  return (
    Math.abs(x) < CABIN.x &&
    y > CABIN.yLow &&
    y < CABIN.yHigh &&
    z > CABIN.zFront &&
    z < CABIN.zRear
  )
}

/** 描画の頂点の数（雪は粒 1 つに 1 頂点、雨は筋 1 本に 2 頂点） */
export function vertexCount(f: Pick<PrecipField, 'kind' | 'count'>): number {
  return f.kind === 'snow' ? f.count : f.count * 2
}

/**
 * 描画の位置を out（Float32Array、vertexCount × 3）に書く。雨の筋は、車から見た相対の速さ（下へ落ちる速さと、
 * 後ろへ流れる車の速さ）の向きに伸ばす（走ると筋が手前へ傾く）
 */
export function writePrecipPositions(f: PrecipField, carSpeedMps: number, out: Float32Array): void {
  const { pos, fall, extra } = f
  for (let i = 0; i < f.count; i++) {
    const x = pos[i * 3] ?? 0
    const y = pos[i * 3 + 1] ?? 0
    const z = pos[i * 3 + 2] ?? 0
    const hidden = insideCabin(x, y, z)
    if (f.kind === 'snow') {
      out[i * 3] = x
      out[i * 3 + 1] = hidden ? HIDDEN_Y : y
      out[i * 3 + 2] = z
      continue
    }
    const vy = fall[i] ?? 0
    const vz = carSpeedMps
    const len = (extra[i] ?? 0) * Math.max(1, Math.hypot(vy, vz) / vy) ** 0.5
    const norm = Math.hypot(vy, vz) || 1
    const o = i * 6
    out[o] = x
    out[o + 1] = hidden ? HIDDEN_Y : y
    out[o + 2] = z
    // 筋の上の端（来た方: 上と前）
    out[o + 3] = x
    out[o + 4] = (hidden ? HIDDEN_Y : y) + (len * vy) / norm
    out[o + 5] = z - (len * vz) / norm
  }
}
