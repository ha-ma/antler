import type { LonLat } from '@antler/zones'

// ルートの線の持ち方（docs/specs/brief-map/functional.md R1）。
// routes.json は encoded polyline（精度 5、緯度・経度の順。Google / OSRM の形式）で線を持つ。
// 取得スクリプトは OSRM の線を Douglas–Peucker（メートル）で間引いてから encode する。

const PRECISION = 1e5
const EARTH_R = 6_371_008.8
const RAD = Math.PI / 180

/** [経度, 緯度] の列を encoded polyline にする（小数 5 桁に丸める）。 */
export function encodePolyline(line: readonly LonLat[]): string {
  let out = ''
  let prevLat = 0
  let prevLon = 0
  for (const [lon, lat] of line) {
    const la = Math.round(lat * PRECISION)
    const lo = Math.round(lon * PRECISION)
    out += encodeValue(la - prevLat) + encodeValue(lo - prevLon)
    prevLat = la
    prevLon = lo
  }
  return out
}

function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1
  let out = ''
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63)
    v >>= 5
  }
  return out + String.fromCharCode(v + 63)
}

/** encoded polyline を [経度, 緯度] の列に戻す。 */
export function decodePolyline(text: string): LonLat[] {
  const out: LonLat[] = []
  let index = 0
  let lat = 0
  let lon = 0
  const next = (): number => {
    let result = 0
    let shift = 0
    let byte: number
    do {
      byte = text.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20 && index < text.length)
    return result & 1 ? ~(result >> 1) : result >> 1
  }
  while (index < text.length) {
    lat += next()
    lon += next()
    out.push([lon / PRECISION, lat / PRECISION])
  }
  return out
}

/** Douglas–Peucker。線の始点を原点にした平面（メートル）で、許容 toleranceM を超える点だけを残す。 */
export function simplify(line: readonly LonLat[], toleranceM: number): LonLat[] {
  if (line.length <= 2) return [...line]
  const origin = line[0] as LonLat
  const xy = line.map((p) => toLocal(origin, p))
  const keep = new Array<boolean>(line.length).fill(false)
  keep[0] = true
  keep[line.length - 1] = true
  const stack: [number, number][] = [[0, line.length - 1]]
  while (stack.length > 0) {
    const [from, to] = stack.pop() as [number, number]
    let farthest = -1
    let farthestM = toleranceM
    for (let i = from + 1; i < to; i++) {
      const d = distanceToSegment(xy[i], xy[from], xy[to])
      if (d > farthestM) {
        farthest = i
        farthestM = d
      }
    }
    if (farthest >= 0) {
      keep[farthest] = true
      stack.push([from, farthest], [farthest, to])
    }
  }
  return line.filter((_, i) => keep[i])
}

type XY = readonly [number, number]

/** origin を原点にした局所座標 [東 m, 北 m]（@antler/zones の geo.ts と同じ正距円筒の近似） */
function toLocal(origin: LonLat, p: LonLat): XY {
  return [
    (p[0] - origin[0]) * RAD * EARTH_R * Math.cos(origin[1] * RAD),
    (p[1] - origin[1]) * RAD * EARTH_R,
  ]
}

function distanceToSegment(p: XY | undefined, a: XY | undefined, b: XY | undefined): number {
  if (!p || !a || !b) return 0
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t))
}
