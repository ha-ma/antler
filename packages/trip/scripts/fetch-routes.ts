// 地点の組ごとの道（ルートの線・距離・所要）を OSRM から取り、data/routes.json に書く
// （docs/specs/brief-map/functional.md R1、ch9 ① d）。api も画面も実行時に OSRM へ通信しない。
//
//   npm run fetch:routes -w @antler/trip            # 全ての組を取り直す（約 200 件、1 秒に 1 件で 4 分ほど）
//
// 取得元は OSRM の公開デモサーバー（キー不要）。利用条件に従い、1 秒に 1 件まで・User-Agent を付ける。
// https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server 。データは © OpenStreetMap contributors（ODbL）。
// 線は overview=full を Douglas–Peucker 15 m で間引き、encoded polyline（精度 5）で持つ。
// 地点のマスターを足したら、このスクリプトを走らせ直す（roads.test.ts が「組が全部ある」を確かめる）。
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { distanceToPolyline, type LonLat } from '@antler/zones'
import { placeById } from '../src/places'
import { encodePolyline, simplify } from '../src/day/polyline'
import { CLOSURE_RADIUS_M, roadKey, roadPairs, WINTER_CLOSURES } from '../src/day/road-pairs'

const OSRM = 'https://router.project-osrm.org/route/v1/driving'
const USER_AGENT = 'antler-ezoroad-route-fetch/0.1 (Built with Claude Japan 2026 hackathon)'
/** 間引きの許容 m（planRoute は 25 m 刻みで中心線から 150 m 以内を見る） */
const SIMPLIFY_M = 15
/** 所要時間の係数（冬道・観光の寄り道。functional.md R1、推奨で決定） */
const DURATION_FACTOR = 1.2
const INTERVAL_MS = 1100
const TIMEOUT_MS = 30_000
const RETRY_WAIT_MS = [2000, 4000, 8000]

const OsrmResponse = z.object({
  code: z.literal('Ok'),
  routes: z
    .array(
      z.object({
        distance: z.number().positive(),
        duration: z.number().positive(),
        geometry: z.object({ coordinates: z.array(z.tuple([z.number(), z.number()])).min(2) }),
      }),
    )
    .min(1),
})

const here = path.dirname(fileURLToPath(import.meta.url))
const outFile = path.resolve(here, '../data/routes.json')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 線が冬に閉まる道の近くを通るなら、その迂回の経由点 */
function closureVia(line: readonly LonLat[]): LonLat | null {
  const hit = WINTER_CLOSURES.find(
    (c) => distanceToPolyline(c.at, line).distanceM <= CLOSURE_RADIUS_M,
  )
  return hit ? hit.via : null
}

async function fetchRoad(from: string, to: string) {
  const a = placeById(from)
  const b = placeById(to)
  if (!a || !b) throw new Error(`地点が無い: ${from} → ${to}`)
  const ends: LonLat[] = [
    [a.lon, a.lat],
    [b.lon, b.lat],
  ]
  const direct = await fetchRoute(ends)
  const via = closureVia(direct.line)
  if (!via) return encode(direct)
  process.stderr.write(`  winter detour ${from}→${to}\n`)
  await sleep(INTERVAL_MS)
  const detour = await fetchRoute([ends[0] as LonLat, via, ends[1] as LonLat])
  if (closureVia(detour.line)) throw new Error(`迂回しても閉まる道を通る: ${from} → ${to}`)
  return encode(detour)
}

function encode(road: { distanceM: number; durationS: number; line: LonLat[] }) {
  return {
    distanceM: Math.round(road.distanceM),
    durationS: Math.round(road.durationS),
    polyline: encodePolyline(simplify(road.line, SIMPLIFY_M)),
  }
}

async function fetchRoute(points: readonly LonLat[]) {
  const coords = points.map(([lon, lat]) => `${lon},${lat}`).join(';')
  const url = `${OSRM}/${coords}?overview=full&geometries=geojson&steps=false`
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = OsrmResponse.parse(await res.json())
      const route = body.routes[0] as z.infer<typeof OsrmResponse>['routes'][number]
      return {
        distanceM: route.distance,
        durationS: route.duration,
        line: route.geometry.coordinates as LonLat[],
      }
    } catch (error) {
      const wait = RETRY_WAIT_MS[attempt]
      if (wait === undefined) throw error
      process.stderr.write(`retry ${coords}: ${String(error)}\n`)
      await sleep(wait)
    }
  }
}

async function main() {
  const pairs = roadPairs()
  const roads: Record<string, ReturnType<typeof encode>> = {}
  for (const [i, [from, to]] of pairs.entries()) {
    roads[roadKey(from, to)] = await fetchRoad(from, to)
    process.stderr.write(`${i + 1}/${pairs.length} ${from}→${to}\n`)
    await sleep(INTERVAL_MS)
  }
  const file = {
    meta: {
      source: 'OSRM demo server (router.project-osrm.org), profile driving, overview=full',
      attribution: '© OpenStreetMap contributors (ODbL)',
      fetchedAt: new Date().toISOString().slice(0, 10),
      simplifyM: SIMPLIFY_M,
      durationFactor: DURATION_FACTOR,
      winterClosures: WINTER_CLOSURES.map((c) => c.name),
      direction: 'key "a|b" (a < b) holds the line from a to b; reverse it for b to a',
    },
    roads,
  }
  writeFileSync(outFile, `${JSON.stringify(file, null, 1)}\n`)
  process.stderr.write(`wrote ${outFile}\n`)
}

await main()
