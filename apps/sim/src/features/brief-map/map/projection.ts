import type { LonLat } from '@antler/zones'

// 地図の座標の変換（docs/specs/brief-map/functional.md R9）。
// 背景（MapLibre）があるときは MapLibre の project を、背景なしのときは fitProjection を使う。どちらも同じ SVG を描く。

/** 経度・緯度 → 枠の中のピクセル [x, y]（左上が原点） */
export type Project = (p: LonLat) => readonly [number, number]

export type Bounds = { west: number; south: number; east: number; north: number }
export type Size = { width: number; height: number }

export function boundsOf(lines: readonly (readonly LonLat[])[]): Bounds {
  const b = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity }
  for (const line of lines) {
    for (const [lon, lat] of line) {
      b.west = Math.min(b.west, lon)
      b.east = Math.max(b.east, lon)
      b.south = Math.min(b.south, lat)
      b.north = Math.max(b.north, lat)
    }
  }
  return b
}

/** Web メルカトルの y（北が大きい） */
function mercatorY(lat: number): number {
  const rad = (lat * Math.PI) / 180
  return Math.log(Math.tan(Math.PI / 4 + rad / 2))
}

const toX = (lon: number) => (lon * Math.PI) / 180

/** 範囲を枠（padding の余白つき）に収める、北が上の Web メルカトル（MapLibre と同じ投影） */
export function fitProjection(bounds: Bounds, size: Size, padding: number): Project {
  const x0 = toX(bounds.west)
  const x1 = toX(bounds.east)
  const y0 = mercatorY(bounds.south)
  const y1 = mercatorY(bounds.north)
  const innerW = Math.max(1, size.width - padding * 2)
  const innerH = Math.max(1, size.height - padding * 2)
  const spanX = x1 - x0
  const spanY = y1 - y0
  const scale =
    spanX <= 0 && spanY <= 0
      ? 1
      : Math.min(innerW / (spanX || Infinity), innerH / (spanY || Infinity))
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  return ([lon, lat]) => [
    size.width / 2 + (toX(lon) - cx) * scale,
    size.height / 2 - (mercatorY(lat) - cy) * scale,
  ]
}
