import { pointAtKm, sliceByKm, type DayPlan } from '@antler/trip'
import type { LonLat } from '@antler/zones'
import type { Project } from './projection'

// 地図に重ねる SVG の形（docs/specs/brief-map/functional.md R9）。DayPlan と投影から、path の d と点の位置を作る純粋関数。
// ゾーンの帯はルートを区間（entryKm〜exitKm）で切って描く（zones.geojson を画面に載せない）。

export type OverlayPoint = {
  kind: 'depart' | 'stop' | 'arrive'
  /** 地点の id（Place.id） */
  place: string
  /** 時刻（ISO）。経由点は到着の時刻 */
  at: string
  x: number
  y: number
}

export type OverlayLabel = {
  /** DayPlan.zones の添字 */
  passage: number
  x: number
  y: number
}

export type Overlay = {
  /** ゾーンの外のルート（実線） */
  routeOutside: string[]
  /** ゾーンの中のルート（破線。色だけに頼らない） */
  routeInside: string[]
  /** ゾーンの帯（alert-zone 45 %、幅 22 px） */
  bands: string[]
  points: OverlayPoint[]
  labels: OverlayLabel[]
}

function pathOf(line: readonly LonLat[], project: Project): string {
  return line
    .map((p, i) => {
      const [x, y] = project(p)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
}

export function buildOverlay(day: DayPlan, project: Project): Overlay {
  const overlay: Overlay = { routeOutside: [], routeInside: [], bands: [], points: [], labels: [] }
  day.legs.forEach((leg, index) => {
    const passages = day.zones.filter((z) => z.leg === index)
    let cursor = 0
    for (const z of passages) {
      overlay.routeOutside.push(pathOf(sliceByKm(leg.route, cursor, z.entryKm), project))
      const inside = pathOf(sliceByKm(leg.route, z.entryKm, z.exitKm), project)
      overlay.routeInside.push(inside)
      overlay.bands.push(inside)
      const [x, y] = project(pointAtKm(leg.route, (z.entryKm + z.exitKm) / 2))
      overlay.labels.push({ passage: day.zones.indexOf(z), x, y })
      cursor = z.exitKm
    }
    // 最後の区間の出口から終点まで（sliceByKm は線の終わりで止まる）
    overlay.routeOutside.push(pathOf(sliceByKm(leg.route, cursor, Infinity), project))

    const start = leg.route[0] as LonLat
    const end = leg.route[leg.route.length - 1] as LonLat
    if (index === 0)
      overlay.points.push({
        kind: 'depart',
        place: leg.from,
        at: leg.departAt,
        ...xy(project(start)),
      })
    const last = index === day.legs.length - 1
    overlay.points.push({
      kind: last ? 'arrive' : 'stop',
      place: leg.to,
      at: leg.arriveAt,
      ...xy(project(end)),
    })
  })
  return overlay
}

const xy = ([x, y]: readonly [number, number]) => ({ x, y })
