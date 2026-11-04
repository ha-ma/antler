import type { LonLat } from '@antler/zones'
import { fromPlane, toPlane, type PlaneXZ } from './road'

// ルートの形を整える（drive-3d R1・drive-link R3）。頂点を通るなめらかな線にして、ROUTE_STEP_M ごとに打ち直す。
// 3D の道の角を丸め、道のり s の物差し（planRoute の cumulativeM）を細かくする。見本の場面も旅の場面も同じ処理。

/** ルートの頂点の間隔（m） */
export const ROUTE_STEP_M = 20

/** 緯度経度の折れ線をなめらかにして、step m ごとに打ち直す */
export function smoothRoute(line: readonly LonLat[], step = ROUTE_STEP_M): LonLat[] {
  const origin = line[0]
  if (!origin) return []
  const pts = dedupe(line.map((p) => toPlane(origin, p)))
  if (pts.length < 2) return pts.map((p) => fromPlane(origin, p))
  return resample(catmullRom(pts), step).map((p) => fromPlane(origin, p))
}

/** 平面の折れ線版（見本の場面が前後に直線を足してから使う） */
export function smoothPlane(points: PlaneXZ[], step = ROUTE_STEP_M): PlaneXZ[] {
  return resample(catmullRom(dedupe(points)), step)
}

/** 1 m 未満で続く点を落とす（区間のつなぎ目の重複） */
function dedupe(points: PlaneXZ[]): PlaneXZ[] {
  return points.filter((p, i) => {
    const prev = points[i - 1]
    return !prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) >= 1
  })
}

/** centripetal Catmull-Rom で頂点を通るなめらかな線にする（線分を細かく刻む） */
function catmullRom(points: PlaneXZ[]): PlaneXZ[] {
  const out: PlaneXZ[] = []
  for (let i = 0; i + 1 < points.length; i++) {
    const p1 = points[i] as PlaneXZ
    const p2 = points[i + 1] as PlaneXZ
    const p0 = points[i - 1] ?? mirror(p2, p1)
    const p3 = points[i + 2] ?? mirror(p1, p2)
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1])
    const steps = Math.max(1, Math.ceil(segLen / 5))
    for (let k = 0; k < steps; k++) out.push(centripetal(p0, p1, p2, p3, k / steps))
  }
  const end = points[points.length - 1]
  if (end) out.push(end)
  return out
}

function mirror(a: PlaneXZ, center: PlaneXZ): PlaneXZ {
  return [2 * center[0] - a[0], 2 * center[1] - a[1]]
}

/** Barry–Goldman の式（alpha = 0.5） */
function centripetal(p0: PlaneXZ, p1: PlaneXZ, p2: PlaneXZ, p3: PlaneXZ, u: number): PlaneXZ {
  const knot = (a: PlaneXZ, b: PlaneXZ) =>
    Math.max(1e-6, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])))
  const t0 = 0
  const t1 = t0 + knot(p0, p1)
  const t2 = t1 + knot(p1, p2)
  const t3 = t2 + knot(p2, p3)
  const t = t1 + (t2 - t1) * u
  const lerp = (a: PlaneXZ, b: PlaneXZ, ta: number, tb: number): PlaneXZ => {
    const w = (t - ta) / (tb - ta)
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w]
  }
  const a1 = lerp(p0, p1, t0, t1)
  const a2 = lerp(p1, p2, t1, t2)
  const a3 = lerp(p2, p3, t2, t3)
  const b1 = lerp(a1, a2, t0, t2)
  const b2 = lerp(a2, a3, t1, t3)
  return lerp(b1, b2, t1, t2)
}

/** 折れ線を step m ごとの点に打ち直す（始点と終点は残す） */
function resample(points: PlaneXZ[], step: number): PlaneXZ[] {
  const first = points[0]
  if (!first) return []
  const out: PlaneXZ[] = [first]
  let carry = 0
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i] as PlaneXZ
    const b = points[i + 1] as PlaneXZ
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    let at = step - carry
    while (at <= len) {
      const w = at / len
      out.push([a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w])
      at += step
    }
    carry = len - (at - step)
  }
  const last = points[points.length - 1] as PlaneXZ
  const tail = out[out.length - 1] as PlaneXZ
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > 1) out.push(last)
  return out
}
