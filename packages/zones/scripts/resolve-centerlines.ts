// data/zones.waypoints.json（人が置いた始点・経由点・終点）と国土数値情報 道路データ（N13）から、
// 国道の中心線をたどって data/zones.source.json を書く（functional.md R1）。
//
//   bash scripts/fetch-roads.sh                       # N13 のメッシュを data/cache/ に取得（初回だけ）
//   npm run resolve:zones -w @antler/zones            # → data/zones.source.json
//   npm run build:zones -w @antler/zones              # → data/zones.geojson
//
// N13 には路線番号もキロポストも無い。だから「道路分類 = 国道（N13_003 = 1）」の線だけでネットワークを作り、
// 各点をいちばん近い国道の線に落としてから、点と点を最短経路で結ぶ。別の国道に迷い込んでいないかを、
// 中心線の長さと始点・終点の直線距離の比（MAX_DETOUR_RATIO 以下）で確かめる。
// 同じ入力からは毎回同じ出力になるよう、時刻や乱数を使わない。
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import {
  distanceToPolyline,
  metersBetween,
  polylineLengthM,
  toLocal,
  type LonLat,
} from '../src/geo'
import { LocalizedRoad, ZONE_ID, ZoneSourceRef } from '../src/zone-db'
import { HALF_WIDTH_M, MERGE_GAP_M, type ZoneSourceFile } from './zones-builder'

/** 中心線の長さ ÷ 始点・終点の直線距離 がこれを超えたら失敗（別の国道に迷い込んだ疑い） */
export const MAX_DETOUR_RATIO = 2.5
/** 点を国道の線に落とすときの最大距離 m。これより遠ければ地名の座標が道から離れすぎ（別の場所・別の道の疑い） */
export const MAX_SNAP_M = 400
/** 中心線の間引き（Douglas-Peucker の許容誤差 m）。N13 の位置の標準偏差は 25 m */
export const SIMPLIFY_TOLERANCE_M = 10

const here = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.resolve(here, '../data')

// ---------- 入力（waypoints） ----------

const Coord = z.tuple([z.number().min(139.3).max(145.9), z.number().min(41.3).max(45.6)])

const Waypoint = z.strictObject({
  /** [経度, 緯度]。地名検索 API の結果をそのまま置く */
  lonLat: Coord,
  /** 何の座標か（地名・IC 名・橋やトンネルの名前） */
  name: z.string().min(1),
  /** 座標をどう得たか（検索語・API・返ってきた名称） */
  basis: z.string().min(1),
  /**
   * 国道の線に落とすときの上限 m（省略時 MAX_SNAP_M）。地区の代表点が道から離れている場合だけ広げ、
   * 理由を basis に書く。落ちた先が正しい国道かは地図で確かめる。
   */
  maxSnapM: z.number().int().positive().max(1500).optional(),
})

const WaypointZone = z.strictObject({
  id: z.string().regex(ZONE_ID),
  route: z.number().int().min(1).max(999),
  roadName: LocalizedRoad,
  section: z.strictObject({ ja: z.string().min(1), en: z.string().min(1) }),
  grade: z.strictObject({
    scale: z.enum(['hkd-r8', 'kushiro-r3r7']),
    level: z.number().int().min(1).max(6),
    label: z.string().min(1),
  }),
  confidence: z.enum(['high', 'medium', 'low']),
  /** 区間の位置・段階をなぜこう置いたか（人が読むための説明。source.json には入れない） */
  note: z.string().min(1),
  sources: z.array(ZoneSourceRef).min(1),
  /** 始点・（経由点）・終点の順 */
  waypoints: z.array(Waypoint).min(2),
  /**
   * 始点から国道沿いにこの km で切る（省略時は終点まで）。区間の端に地名が無いとき、遠くの地名を「向き」にして
   * 長さで区切るために使う。理由を note に書く。
   */
  cutAtKm: z.number().min(1).max(10).optional(),
})

const WaypointFile = z.strictObject({
  $comment: z.string().optional(),
  version: z.number().int().min(1),
  geocoder: z.strictObject({ name: z.string(), url: z.string().url(), accessed: z.string() }),
  /** 道路中心線の出典。各ゾーンの sources の末尾に足す */
  centerlineSource: ZoneSourceRef,
  factors: z.strictObject({
    $comment: z.string().optional(),
    months: z.array(z.number().min(0).max(1)).length(12),
    periods: z.strictObject({
      dawn: z.number().min(0).max(1),
      day: z.number().min(0).max(1),
      dusk: z.number().min(0).max(1),
      night: z.number().min(0).max(1),
    }),
    source: ZoneSourceRef.omit({ modified: true, period: true }),
  }),
  zones: z.array(WaypointZone).min(1),
  /** 入れなかったゾーン（理由つき。スクリプトは読まない） */
  excluded: z.array(z.strictObject({ id: z.string(), reason: z.string() })).optional(),
})
type WaypointFile = z.infer<typeof WaypointFile>
type WaypointZone = z.infer<typeof WaypointZone>

// ---------- 道路ネットワーク ----------

type Edge = { a: string; b: string; coords: LonLat[]; lengthM: number }

type Network = {
  edges: Edge[]
  /** node → 接続する edge の番号 */
  adjacency: Map<string, number[]>
  meshes: Set<string>
}

const N13Feature = z.object({
  properties: z.object({
    N13_002: z.string(), // 種別（1 = 通常部）
    N13_003: z.string(), // 道路分類（1 = 国道、4 = 高速自動車国道等）
    N13_004: z.string(), // 道路状態（5 = 建設中）
  }),
  geometry: z.object({
    type: z.literal('LineString'),
    coordinates: z.array(z.tuple([z.number(), z.number()]).rest(z.number())).min(2),
  }),
})
const N13File = z.object({ features: z.array(z.unknown()) })

const nodeKey = (p: LonLat) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`

/** 1 次メッシュ番号（緯度 40 分 × 経度 1 度）。 */
export function primaryMesh([lon, lat]: LonLat): string {
  return `${String(Math.floor(lat * 1.5))}${String(Math.floor(lon - 100))}`
}

function findN13Files(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...findN13Files(full))
    else if (/^N13-24_\d{4}\.geojson$/.test(entry.name)) out.push(full)
  }
  return out.sort()
}

function loadNetwork(cacheDir: string): Network {
  const files = findN13Files(cacheDir)
  if (files.length === 0) {
    throw new Error(
      `${cacheDir} に N13 の GeoJSON がありません。先に bash scripts/fetch-roads.sh を実行してください`,
    )
  }
  const edges: Edge[] = []
  const meshes = new Set<string>()
  for (const file of files) {
    meshes.add(path.basename(file).slice(7, 11))
    const raw = N13File.parse(JSON.parse(readFileSync(file, 'utf-8')))
    for (const item of raw.features) {
      const f = N13Feature.parse(item)
      const { N13_002: type, N13_003: category, N13_004: state } = f.properties
      if (category !== '1' || type !== '1' || state === '5') continue
      const coords = f.geometry.coordinates.map((c) => [c[0], c[1]] as LonLat)
      const first = coords[0] as LonLat
      const last = coords[coords.length - 1] as LonLat
      edges.push({ a: nodeKey(first), b: nodeKey(last), coords, lengthM: polylineLengthM(coords) })
    }
  }
  return { edges, adjacency: buildAdjacency(edges), meshes }
}

function buildAdjacency(edges: Edge[]): Map<string, number[]> {
  const adjacency = new Map<string, number[]>()
  edges.forEach((e, i) => {
    for (const n of [e.a, e.b]) {
      const list = adjacency.get(n)
      if (list) list.push(i)
      else adjacency.set(n, [i])
    }
  })
  return adjacency
}

// ---------- 点を線に落とす ----------

type Snap = { edge: number; seg: number; t: number; point: LonLat; distanceM: number }

function snapToNetwork(p: LonLat, edges: Edge[]): Snap | null {
  const marginDeg = 0.02 // 北海道の緯度で東西 1.6 km・南北 2.2 km ほど
  let best: Snap | null = null
  edges.forEach((e, i) => {
    let inBox = false
    for (const c of e.coords) {
      if (Math.abs(c[0] - p[0]) < marginDeg * 4 && Math.abs(c[1] - p[1]) < marginDeg * 4) {
        inBox = true
        break
      }
    }
    if (!inBox) return
    for (let s = 0; s + 1 < e.coords.length; s++) {
      const a = toLocal(p, e.coords[s] as LonLat)
      const b = toLocal(p, e.coords[s + 1] as LonLat)
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const len2 = dx * dx + dy * dy
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / len2))
      const d = Math.hypot(a[0] + t * dx, a[1] + t * dy)
      if (!best || d < best.distanceM) {
        const ca = e.coords[s] as LonLat
        const cb = e.coords[s + 1] as LonLat
        const point: LonLat = [ca[0] + t * (cb[0] - ca[0]), ca[1] + t * (cb[1] - ca[1])]
        best = { edge: i, seg: s, t, point, distanceM: d }
      }
    }
  })
  return best
}

/** 落とした点で線を切り、点ごとの node 名（snap:<番号>）を持つネットワークを作り直す。 */
function splitAtSnaps(network: Network, snaps: Snap[]): Network {
  const byEdge = new Map<number, { snap: Snap; key: string }[]>()
  snaps.forEach((snap, i) => {
    const list = byEdge.get(snap.edge) ?? []
    list.push({ snap, key: `snap:${String(i)}` })
    byEdge.set(snap.edge, list)
  })
  const edges: Edge[] = []
  network.edges.forEach((edge, i) => {
    const cuts = byEdge.get(i)
    if (!cuts) {
      edges.push(edge)
      return
    }
    cuts.sort((x, y) => x.snap.seg - y.snap.seg || x.snap.t - y.snap.t)
    let fromKey = edge.a
    let current: LonLat[] = [edge.coords[0] as LonLat]
    let seg = 0
    for (const { snap, key } of cuts) {
      while (seg < snap.seg) {
        current.push(edge.coords[seg + 1] as LonLat)
        seg += 1
      }
      current.push(snap.point)
      edges.push({ a: fromKey, b: key, coords: current, lengthM: polylineLengthM(current) })
      fromKey = key
      current = [snap.point]
    }
    for (let s = seg + 1; s < edge.coords.length; s++) current.push(edge.coords[s] as LonLat)
    edges.push({ a: fromKey, b: edge.b, coords: current, lengthM: polylineLengthM(current) })
  })
  return { edges, adjacency: buildAdjacency(edges), meshes: network.meshes }
}

// ---------- 最短経路 ----------

class MinHeap {
  private items: [number, string][] = []
  get size() {
    return this.items.length
  }
  push(item: [number, string]) {
    const items = this.items
    items.push(item)
    let i = items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if ((items[parent] as [number, string])[0] <= item[0]) break
      items[i] = items[parent] as [number, string]
      i = parent
    }
    items[i] = item
  }
  pop(): [number, string] | undefined {
    const items = this.items
    const top = items[0]
    const last = items.pop()
    if (items.length > 0 && last) {
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        const mv = () => (m === i ? last[0] : (items[m] as [number, string])[0])
        if (l < items.length && (items[l] as [number, string])[0] < mv()) m = l
        if (r < items.length && (items[r] as [number, string])[0] < mv()) m = r
        if (m === i) break
        items[i] = items[m] as [number, string]
        i = m
      }
      items[i] = last
    }
    return top
  }
}

/** from から to への最短経路の座標列。たどれなければ null。 */
function shortestPath(network: Network, from: string, to: string): LonLat[] | null {
  const dist = new Map<string, number>([[from, 0]])
  const prev = new Map<string, { node: string; edge: number }>()
  const heap = new MinHeap()
  heap.push([0, from])
  while (heap.size > 0) {
    const top = heap.pop()
    if (!top) break
    const [d, node] = top
    if (d > (dist.get(node) ?? Number.POSITIVE_INFINITY)) continue
    if (node === to) break
    for (const ei of network.adjacency.get(node) ?? []) {
      const e = network.edges[ei] as Edge
      const next = e.a === node ? e.b : e.a
      const nd = d + e.lengthM
      if (nd < (dist.get(next) ?? Number.POSITIVE_INFINITY)) {
        dist.set(next, nd)
        prev.set(next, { node, edge: ei })
        heap.push([nd, next])
      }
    }
  }
  if (!dist.has(to)) return null
  const pieces: LonLat[][] = []
  let node = to
  while (node !== from) {
    const step = prev.get(node)
    if (!step) return null
    const e = network.edges[step.edge] as Edge
    pieces.push(e.a === step.node ? e.coords : [...e.coords].reverse())
    node = step.node
  }
  const line: LonLat[] = []
  for (const piece of pieces.reverse()) {
    for (const c of piece) {
      const last = line[line.length - 1]
      if (!last || last[0] !== c[0] || last[1] !== c[1]) line.push(c)
    }
  }
  return line
}

/** 折れ線を始点から lengthM で切る（線がそれより短ければそのまま）。 */
export function cutAt(line: LonLat[], lengthM: number): LonLat[] {
  const out: LonLat[] = [line[0] as LonLat]
  let walked = 0
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i] as LonLat
    const b = line[i + 1] as LonLat
    const seg = metersBetween(a, b)
    if (walked + seg >= lengthM) {
      const t = seg === 0 ? 0 : (lengthM - walked) / seg
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])])
      return out
    }
    out.push(b)
    walked += seg
  }
  return out
}

// ---------- 間引き ----------

/** Douglas-Peucker（その場の平面でメートルに直して測る）。 */
export function simplify(line: LonLat[], toleranceM: number): LonLat[] {
  if (line.length <= 2) return line
  const origin = line[0] as LonLat
  const pts = line.map((p) => toLocal(origin, p))
  const keep = new Array<boolean>(line.length).fill(false)
  keep[0] = true
  keep[line.length - 1] = true
  const stack: [number, number][] = [[0, line.length - 1]]
  while (stack.length > 0) {
    const [i, j] = stack.pop() as [number, number]
    const a = pts[i] as [number, number]
    const b = pts[j] as [number, number]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy)
    let worst = -1
    let worstD = 0
    for (let k = i + 1; k < j; k++) {
      const p = pts[k] as [number, number]
      const d =
        len === 0
          ? Math.hypot(p[0] - a[0], p[1] - a[1])
          : Math.abs(dx * (a[1] - p[1]) - dy * (a[0] - p[0])) / len
      if (d > worstD) {
        worstD = d
        worst = k
      }
    }
    if (worst >= 0 && worstD > toleranceM) {
      keep[worst] = true
      stack.push([i, worst], [worst, j])
    }
  }
  return line.filter((_, k) => keep[k])
}

const round6 = (p: LonLat): [number, number] => [
  Math.round(p[0] * 1e6) / 1e6,
  Math.round(p[1] * 1e6) / 1e6,
]

// ---------- 本体 ----------

export type ResolvedZone = {
  id: string
  route: number
  centerline: [number, number][]
  lengthM: number
  straightM: number
  ratio: number
  snapsM: number[]
}

export type ResolveFailure = { id: string; reason: string }

export function resolveZones(
  file: WaypointFile,
  network: Network,
): { resolved: ResolvedZone[]; failures: ResolveFailure[] } {
  const failures: ResolveFailure[] = []
  // 全ゾーンの点を先に落とし、まとめて線を切る
  const snaps: Snap[] = []
  const snapIndex: number[][] = []
  for (const zone of file.zones) {
    const indices: number[] = []
    for (const wp of zone.waypoints) {
      const mesh = primaryMesh(wp.lonLat)
      if (!network.meshes.has(mesh)) {
        failures.push({
          id: zone.id,
          reason: `${wp.name} はメッシュ ${mesh} にあるが cache に無い（fetch-roads.sh に足す）`,
        })
      }
      const snap = snapToNetwork(wp.lonLat, network.edges)
      if (!snap) {
        failures.push({ id: zone.id, reason: `${wp.name} の近くに国道の線が無い` })
        indices.push(-1)
        continue
      }
      const maxSnapM = wp.maxSnapM ?? MAX_SNAP_M
      if (snap.distanceM > maxSnapM) {
        failures.push({
          id: zone.id,
          reason: `${wp.name} から国道の線まで ${snap.distanceM.toFixed(0)} m（上限 ${String(maxSnapM)} m）`,
        })
      }
      indices.push(snaps.length)
      snaps.push(snap)
    }
    snapIndex.push(indices)
  }
  const split = splitAtSnaps(network, snaps)

  const resolved: ResolvedZone[] = []
  file.zones.forEach((zone, zi) => {
    if (failures.some((f) => f.id === zone.id)) return
    const indices = snapIndex[zi] as number[]
    let line: LonLat[] = []
    for (let k = 0; k + 1 < indices.length; k++) {
      const leg = shortestPath(
        split,
        `snap:${String(indices[k])}`,
        `snap:${String(indices[k + 1])}`,
      )
      if (!leg) {
        const a = zone.waypoints[k]?.name ?? '?'
        const b = zone.waypoints[k + 1]?.name ?? '?'
        failures.push({
          id: zone.id,
          reason: `${a} → ${b} を国道の線だけでたどれない（線の途切れ、またはメッシュの不足）`,
        })
        return
      }
      line = line.length === 0 ? leg : [...line, ...leg.slice(1)]
    }
    // 切る前（地名から地名まで）と切った後の両方で、遠回りしていないかを確かめる
    const lines = zone.cutAtKm === undefined ? [line] : [line, cutAt(line, zone.cutAtKm * 1000)]
    let lengthM = 0
    let straightM = 0
    let ratio = 0
    for (const l of lines) {
      lengthM = polylineLengthM(l)
      straightM = metersBetween(l[0] as LonLat, l[l.length - 1] as LonLat)
      ratio = straightM === 0 ? Number.POSITIVE_INFINITY : lengthM / straightM
      if (ratio > MAX_DETOUR_RATIO) {
        failures.push({
          id: zone.id,
          reason: `中心線 ${(lengthM / 1000).toFixed(2)} km ÷ 直線 ${(straightM / 1000).toFixed(2)} km = ${ratio.toFixed(2)}（上限 ${String(MAX_DETOUR_RATIO)}。別の国道に迷い込んだ疑い）`,
        })
        return
      }
    }
    line = lines[lines.length - 1] as LonLat[]
    const centerline: [number, number][] = []
    for (const p of simplify(line, SIMPLIFY_TOLERANCE_M).map(round6)) {
      const last = centerline[centerline.length - 1]
      if (!last || last[0] !== p[0] || last[1] !== p[1]) centerline.push(p)
    }
    resolved.push({
      id: zone.id,
      route: zone.route,
      centerline,
      lengthM: polylineLengthM(centerline),
      straightM,
      ratio,
      snapsM: indices.map((i) => (snaps[i] as Snap).distanceM),
    })
  })
  return { resolved, failures }
}

/** 同じ路線のゾーンどうしの中心線の最短距離 m（生成スクリプトはこれが MERGE_GAP_M + 2×HALF_WIDTH_M 以下だと失敗する）。 */
export function sameRouteGaps(zones: ResolvedZone[]): { a: string; b: string; gapM: number }[] {
  const out: { a: string; b: string; gapM: number }[] = []
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      const a = zones[i] as ResolvedZone
      const b = zones[j] as ResolvedZone
      if (a.route !== b.route) continue
      const gapM = Math.min(
        ...b.centerline.map((p) => distanceToPolyline(p, a.centerline).distanceM),
        ...a.centerline.map((p) => distanceToPolyline(p, b.centerline).distanceM),
      )
      out.push({ a: a.id, b: b.id, gapM })
    }
  }
  return out
}

export function toSourceFile(file: WaypointFile, resolved: ResolvedZone[]): ZoneSourceFile {
  const byId = new Map(resolved.map((r) => [r.id, r]))
  const zones = [...file.zones]
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((zone: WaypointZone) => {
      const r = byId.get(zone.id)
      if (!r) return []
      return [
        {
          id: zone.id,
          route: zone.route,
          roadName: zone.roadName,
          section: zone.section,
          grade: zone.grade,
          confidence: zone.confidence,
          sources: [...zone.sources, file.centerlineSource],
          centerline: r.centerline,
        },
      ]
    })
  const { months, periods, source } = file.factors
  return { version: file.version, factors: { months, periods, source }, zones }
}

/** 座標の組だけ 1 行にした JSON（人が差分を読みやすいように）。 */
export function renderSourceFile(source: ZoneSourceFile): string {
  const text = JSON.stringify(source, null, 2).replace(
    /\[\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g,
    (_m, a: string, b: string) => `[${a}, ${b}]`,
  )
  return `${text}\n`
}

function main() {
  const file = WaypointFile.parse(
    JSON.parse(readFileSync(path.join(dataDir, 'zones.waypoints.json'), 'utf-8')),
  )
  const network = loadNetwork(path.join(dataDir, 'cache'))
  const log = (line: string) => process.stdout.write(`${line}\n`)
  log(`N13: メッシュ ${[...network.meshes].join(' ')}、国道の線 ${String(network.edges.length)} 本`)

  const { resolved, failures } = resolveZones(file, network)
  log('')
  log('id                         長さ km  直線 km  比     点→国道 m')
  for (const r of [...resolved].sort((a, b) => a.id.localeCompare(b.id))) {
    log(
      `${r.id.padEnd(26)} ${(r.lengthM / 1000).toFixed(2).padStart(7)}  ${(r.straightM / 1000).toFixed(2).padStart(7)}  ${r.ratio.toFixed(2).padStart(5)}  ${r.snapsM.map((d) => d.toFixed(0)).join(' / ')}`,
    )
  }
  const minGap = MERGE_GAP_M + 2 * HALF_WIDTH_M
  const gaps = sameRouteGaps(resolved)
  if (gaps.length > 0) {
    log('')
    log(`同じ路線のゾーンどうしの最短距離（${String(minGap)} m 以下だと build:zones が失敗する）`)
    for (const g of gaps) {
      log(`  ${g.a} ↔ ${g.b}: ${g.gapM.toFixed(0)} m${g.gapM <= minGap ? '  ← 近すぎ' : ''}`)
    }
  }
  const tooClose = gaps.filter((g) => g.gapM <= minGap)
  if (failures.length > 0 || tooClose.length > 0) {
    log('')
    for (const f of failures) log(`失敗 ${f.id}: ${f.reason}`)
    for (const g of tooClose) log(`失敗 ${g.b}: ${g.a} と ${g.gapM.toFixed(0)} m しか離れていない`)
    log('zones.source.json は書いていない')
    process.exitCode = 1
    return
  }
  const out = path.join(dataDir, 'zones.source.json')
  writeFileSync(out, renderSourceFile(toSourceFile(file, resolved)))
  log('')
  log(`wrote data/zones.source.json（${String(resolved.length)} ゾーン）`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
