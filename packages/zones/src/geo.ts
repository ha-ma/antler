// 幾何の基本（functional.md R2・R3）。緯度経度のままでなく、その場の接平面（正距円筒）でメートルに直して測る。
// 鹿ゾーンの判定は数 km の範囲なので、この近似の誤差は 0.1% 未満（北海道の緯度で検算）。

/** GeoJSON の並び [経度, 緯度]。 */
export type LonLat = readonly [number, number]

const R = 6_371_008.8 // 地球の平均半径 m
const RAD = Math.PI / 180

/** 北海道の範囲（これより外は unknown。R9）。 */
export const HOKKAIDO_BBOX = { minLon: 139.3, maxLon: 145.9, minLat: 41.3, maxLat: 45.6 } as const

export function inHokkaido([lon, lat]: LonLat): boolean {
  return (
    lon >= HOKKAIDO_BBOX.minLon &&
    lon <= HOKKAIDO_BBOX.maxLon &&
    lat >= HOKKAIDO_BBOX.minLat &&
    lat <= HOKKAIDO_BBOX.maxLat
  )
}

/** origin を原点にした局所座標 [東 m, 北 m]。 */
export function toLocal(origin: LonLat, p: LonLat): [number, number] {
  return [(p[0] - origin[0]) * RAD * R * Math.cos(origin[1] * RAD), (p[1] - origin[1]) * RAD * R]
}

export function fromLocal(origin: LonLat, [x, y]: readonly [number, number]): [number, number] {
  return [origin[0] + x / (RAD * R * Math.cos(origin[1] * RAD)), origin[1] + y / (RAD * R)]
}

export function metersBetween(a: LonLat, b: LonLat): number {
  const [x, y] = toLocal(a, b)
  return Math.hypot(x, y)
}

export function polylineLengthM(line: readonly LonLat[]): number {
  let total = 0
  for (let i = 0; i + 1 < line.length; i++)
    total += metersBetween(line[i] as LonLat, line[i + 1] as LonLat)
  return total
}

export type PolylineProjection = {
  /** 点から線までの最短距離 m */
  distanceM: number
  /** 線の始点から、点を線に落とした位置までの道のり m */
  alongM: number
  /** 線の全長 m */
  totalM: number
}

/** 点から折れ線への最短距離と、線に落とした位置の道のり。 */
export function distanceToPolyline(p: LonLat, line: readonly LonLat[]): PolylineProjection {
  let best = Number.POSITIVE_INFINITY
  let bestAlong = 0
  let walked = 0
  for (let i = 0; i + 1 < line.length; i++) {
    const a = toLocal(p, line[i] as LonLat)
    const b = toLocal(p, line[i + 1] as LonLat)
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / len2))
    const d = Math.hypot(a[0] + t * dx, a[1] + t * dy)
    const segLen = Math.sqrt(len2)
    if (d < best) {
      best = d
      bestAlong = walked + t * segLen
    }
    walked += segLen
  }
  return { distanceM: best, alongM: bestAlong, totalM: walked }
}

/** 線分 pq から折れ線への最短距離（交われば 0）。測位の途切れの「通過」判定に使う（R4）。 */
export function segmentDistanceToPolyline(p: LonLat, q: LonLat, line: readonly LonLat[]): number {
  let best = Number.POSITIVE_INFINITY
  const origin = p
  const P = toLocal(origin, p)
  const Q = toLocal(origin, q)
  for (let i = 0; i + 1 < line.length; i++) {
    const A = toLocal(origin, line[i] as LonLat)
    const B = toLocal(origin, line[i + 1] as LonLat)
    best = Math.min(best, segmentSegmentDistance(P, Q, A, B))
    if (best === 0) return 0
  }
  return best
}

type V = readonly [number, number]

function segmentSegmentDistance(p: V, q: V, a: V, b: V): number {
  if (segmentsIntersect(p, q, a, b)) return 0
  return Math.min(
    pointSegmentDistance(p, a, b),
    pointSegmentDistance(q, a, b),
    pointSegmentDistance(a, p, q),
    pointSegmentDistance(b, p, q),
  )
}

function pointSegmentDistance(p: V, a: V, b: V): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

function cross(o: V, a: V, b: V): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

function segmentsIntersect(p: V, q: V, a: V, b: V): boolean {
  const d1 = cross(a, b, p)
  const d2 = cross(a, b, q)
  const d3 = cross(p, q, a)
  const d4 = cross(p, q, b)
  return d1 * d2 < 0 && d3 * d4 < 0
}

/**
 * 折れ線を片側 radiusM だけ膨らませた輪郭（閉じたリング）。両端は半円。
 * 配布用の見た目と点の内外の近似に使う。内外の判定そのものは中心線からの距離で行う（judge.ts）。
 */
export function bufferPolyline(line: readonly LonLat[], radiusM: number, capSteps = 8): LonLat[] {
  const origin = line[0] as LonLat
  const pts = line.map((p) => toLocal(origin, p))
  const left: V[] = []
  const right: V[] = []
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)] as V
    const next = pts[Math.min(pts.length - 1, i + 1)] as V
    const dx = next[0] - prev[0]
    const dy = next[1] - prev[1]
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len
    const ny = dx / len
    // 角では法線をつなぎ目の半分の角度に向け、距離を保つよう伸ばす（極端な鋭角は 2 倍まで）
    let scale = 1
    if (i > 0 && i < pts.length - 1) {
      const a = pts[i - 1] as V
      const c = pts[i] as V
      const b = pts[i + 1] as V
      const u = norm([c[0] - a[0], c[1] - a[1]])
      const w = norm([b[0] - c[0], b[1] - c[1]])
      const cosHalf = Math.sqrt(Math.max(0, (1 + u[0] * w[0] + u[1] * w[1]) / 2))
      scale = Math.min(2, cosHalf > 0 ? 1 / cosHalf : 2)
    }
    const c = pts[i] as V
    left.push([c[0] + nx * radiusM * scale, c[1] + ny * radiusM * scale])
    right.push([c[0] - nx * radiusM * scale, c[1] - ny * radiusM * scale])
  }
  const ring: V[] = [...left]
  ring.push(...cap(pts[pts.length - 1] as V, pts[pts.length - 2] as V, radiusM, capSteps))
  ring.push(...right.reverse())
  ring.push(...cap(pts[0] as V, pts[1] as V, radiusM, capSteps))
  ring.push(ring[0] as V)
  return ring.map((p) => round6(fromLocal(origin, p)))
}

/** 端 end の外側の半円（end から away へ向かう向きと反対側）。両端の点は含めない。 */
function cap(end: V, inner: V, r: number, steps: number): V[] {
  const dir = norm([end[0] - inner[0], end[1] - inner[1]])
  const base = Math.atan2(dir[1], dir[0])
  const out: V[] = []
  for (let k = 1; k < steps; k++) {
    const a = base + Math.PI / 2 - (Math.PI * k) / steps
    out.push([end[0] + r * Math.cos(a), end[1] + r * Math.sin(a)])
  }
  return out
}

function norm(v: V): [number, number] {
  const l = Math.hypot(v[0], v[1]) || 1
  return [v[0] / l, v[1] / l]
}

function round6(p: readonly [number, number]): LonLat {
  return [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6]
}
