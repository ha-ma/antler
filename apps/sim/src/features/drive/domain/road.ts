import { metersBetween, type LonLat } from '@antler/zones'

// ルートの平面座標と、道のり s・横の位置 d から 3D の位置を出す（R2）。
// 平面はルートの始点を原点にした等距円筒図法: x は東（m）、z は南（m。three.js の -z が北）。
// 道のりは planRoute と同じ物差し（頂点ごとの metersBetween の累積）で数え、
// ゾーン区間の km と車の s がずれないようにする。

const EARTH_R = 6_371_008.8
const RAD = Math.PI / 180
/** 頂点の前後でこの長さだけ向きをなめらかにつなぐ（m） */
const BLEND_M = 8

export type PlaneXZ = [x: number, z: number]

/** 緯度経度 → 平面（m） */
export function toPlane(origin: LonLat, p: LonLat): PlaneXZ {
  const cos = Math.cos(origin[1] * RAD)
  return [(p[0] - origin[0]) * RAD * EARTH_R * cos, -(p[1] - origin[1]) * RAD * EARTH_R]
}

/** 平面（m）→ 緯度経度 */
export function fromPlane(origin: LonLat, [x, z]: PlaneXZ): LonLat {
  const cos = Math.cos(origin[1] * RAD)
  return [origin[0] + x / (RAD * EARTH_R * cos), origin[1] - z / (RAD * EARTH_R)]
}

export type RoadFrame = {
  origin: LonLat
  route: readonly LonLat[]
  /** 頂点の平面座標 */
  points: PlaneXZ[]
  /** 頂点までの道のり（m、planRoute の cumulativeM と同じ） */
  cumulativeM: number[]
  /** 頂点での進む向き（前後の線分の向きの平均。単位ベクトル） */
  tangents: PlaneXZ[]
  lengthM: number
}

export function createRoadFrame(route: readonly LonLat[]): RoadFrame {
  const origin = route[0]
  if (!origin || route.length < 2) throw new RangeError('ルートには 2 点以上が要る')
  const points = route.map((p) => toPlane(origin, p))
  const cumulativeM = [0]
  for (let i = 0; i + 1 < route.length; i++) {
    cumulativeM.push(
      (cumulativeM[i] ?? 0) + metersBetween(route[i] as LonLat, route[i + 1] as LonLat),
    )
  }
  const dirs: PlaneXZ[] = []
  for (let i = 0; i + 1 < points.length; i++) dirs.push(unit(sub(at(points, i + 1), at(points, i))))
  const tangents = points.map((_, i) => {
    const before = dirs[i - 1]
    const after = dirs[i]
    if (before && after) return unit([before[0] + after[0], before[1] + after[1]])
    return (before ?? after) as PlaneXZ
  })
  return { origin, route, points, cumulativeM, tangents, lengthM: cumulativeM.at(-1) ?? 0 }
}

export type RoadPose = {
  x: number
  z: number
  /** 進む向き（rad）。three.js の rotation.y にそのまま入れる（0 は -z＝北、正は左回り） */
  yaw: number
  /** 進む向きの単位ベクトル */
  forward: PlaneXZ
  /** 右の単位ベクトル */
  right: PlaneXZ
}

/** 道のり s・横の位置 d（右が正）→ 平面の位置と向き。頂点の角では向きをなめらかにつなぐ */
export function poseAt(frame: RoadFrame, s: number, d = 0): RoadPose {
  const clamped = Math.min(Math.max(s, 0), frame.lengthM)
  const i = segmentIndex(frame.cumulativeM, clamped)
  const s0 = frame.cumulativeM[i] ?? 0
  const s1 = frame.cumulativeM[i + 1] ?? s0
  const t = s1 > s0 ? (clamped - s0) / (s1 - s0) : 0
  const a = at(frame.points, i)
  const b = at(frame.points, i + 1)
  // 線分の向きを基本にし、頂点から BLEND_M 以内だけ頂点の向きへ寄せる（角で横の位置が飛ばない）
  const dir = unit(sub(b, a))
  const blend = Math.min(BLEND_M, (s1 - s0) / 2)
  let forward = dir
  if (blend > 0 && clamped - s0 < blend) {
    forward = mix(at(frame.tangents, i), dir, (clamped - s0) / blend)
  } else if (blend > 0 && s1 - clamped < blend) {
    forward = mix(at(frame.tangents, i + 1), dir, (s1 - clamped) / blend)
  }
  // 進む向き (fx, fz) の右は (-fz, fx)（x 東・z 南の右手系で、上から見て時計回りに 90°）
  const right: PlaneXZ = [-forward[1], forward[0]]
  const x = a[0] + (b[0] - a[0]) * t + right[0] * d
  const z = a[1] + (b[1] - a[1]) * t + right[1] * d
  return { x, z, yaw: Math.atan2(-forward[0], -forward[1]), forward, right }
}

/** 平面の点を道のり s と横の位置 d に直す（近い線分に落とす。hint があればその近くを探す） */
export function toRoadCoords(
  frame: RoadFrame,
  p: PlaneXZ,
  hintS?: number,
): { s: number; d: number } {
  let best = { s: 0, d: 0, dist: Number.POSITIVE_INFINITY }
  const from = hintS === undefined ? 0 : Math.max(0, segmentIndex(frame.cumulativeM, hintS - 300))
  const to =
    hintS === undefined
      ? frame.points.length - 1
      : Math.min(frame.points.length - 1, segmentIndex(frame.cumulativeM, hintS + 300) + 1)
  for (let i = from; i < to; i++) {
    const a = at(frame.points, i)
    const b = at(frame.points, i + 1)
    const ab = sub(b, a)
    const len2 = ab[0] * ab[0] + ab[1] * ab[1]
    const ap = sub(p, a)
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1]) / len2))
    const q: PlaneXZ = [a[0] + ab[0] * t, a[1] + ab[1] * t]
    const dist = Math.hypot(p[0] - q[0], p[1] - q[1])
    if (dist < best.dist) {
      const s0 = frame.cumulativeM[i] ?? 0
      const s1 = frame.cumulativeM[i + 1] ?? s0
      const dir = unit(ab)
      const side = Math.sign(ap[0] * -dir[1] + ap[1] * dir[0]) || 1
      best = { s: s0 + (s1 - s0) * t, d: side * dist, dist }
    }
  }
  return { s: best.s, d: best.d }
}

/** 道のり s・横の位置 d → 緯度経度（ゾーン判定に渡す） */
export function lonLatAt(frame: RoadFrame, s: number, d = 0): LonLat {
  const pose = poseAt(frame, s, d)
  return fromPlane(frame.origin, [pose.x, pose.z])
}

/** s を含む線分の番号（二分探索） */
function segmentIndex(cumulativeM: number[], s: number): number {
  let lo = 0
  let hi = cumulativeM.length - 2
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if ((cumulativeM[mid] ?? 0) <= s) lo = mid
    else hi = mid - 1
  }
  return Math.max(0, lo)
}

function at(points: PlaneXZ[], i: number): PlaneXZ {
  return points[i] ?? points[points.length - 1] ?? [0, 0]
}

function sub(a: PlaneXZ, b: PlaneXZ): PlaneXZ {
  return [a[0] - b[0], a[1] - b[1]]
}

/** a から b へ w（0〜1）だけ寄せた単位ベクトル */
function mix(a: PlaneXZ, b: PlaneXZ, w: number): PlaneXZ {
  return unit([a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w])
}

function unit(v: PlaneXZ): PlaneXZ {
  const len = Math.hypot(v[0], v[1])
  return len === 0 ? [0, -1] : [v[0] / len, v[1] / len]
}
