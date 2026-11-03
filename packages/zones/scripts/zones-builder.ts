// 元データ（data/zones.source.json）から zones.geojson を作る（functional.md R1）。
// 書き出しは build-zones.ts。build.test.ts が、書き出し済みのファイルとこの出力の一致を確かめる。
// 同じ元データからは毎回同じバイト列になるよう、時刻や乱数を使わない。
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { distanceToPolyline, polylineLengthM, bufferPolyline, type LonLat } from '../src/geo'
import {
  LocalizedRoad,
  ZONE_ID,
  ZoneCollectionSchema,
  ZoneSourceRef,
  type ZoneCollection,
  type ZoneFeature,
} from '../src/zone-db'

/** ゾーンの片側の幅 m（中心線からこの距離までが inside。R2） */
export const HALF_WIDTH_M = 150
/** 同じ路線のゾーンがこれより近ければ 1 つにまとめる（R5） */
export const MERGE_GAP_M = 200

const Unit = z.number().min(0).max(1)

const ZoneSourceEntry = z.strictObject({
  id: z.string().regex(ZONE_ID, 'id は R<路線>-<名前>-<番号>（例 R240-akan-1）'),
  route: z.number().int().min(1).max(999),
  roadName: LocalizedRoad,
  section: z.strictObject({ ja: z.string().min(1), en: z.string().min(1) }),
  grade: z.strictObject({
    scale: z.enum(['hkd-r8', 'kushiro-r3r7']),
    level: z.number().int().min(1).max(6),
    label: z.string().min(1),
  }),
  confidence: z.enum(['high', 'medium', 'low']),
  sources: z.array(ZoneSourceRef).min(1, 'sources（出典）が空'),
  centerline: z.array(z.tuple([z.number(), z.number()])).min(2),
})

const SourceFile = z.strictObject({
  version: z.number().int().min(1),
  factors: z.strictObject({
    /** 1〜12 月の係数（最大 1） */
    months: z.array(Unit).length(12),
    /** 光の区分の係数（最大 1） */
    periods: z.strictObject({ dawn: Unit, day: Unit, dusk: Unit, night: Unit }),
    source: ZoneSourceRef.omit({ modified: true, period: true }),
  }),
  zones: z.array(ZoneSourceEntry),
})
export type ZoneSourceFile = z.input<typeof SourceFile>

export class ZoneBuildError extends Error {
  override name = 'ZoneBuildError'
}

/** 地図の段階 → 基準の重み（0〜1）。開発局 R8 全道版は 4 段階、釧路開建は 6 段階。 */
const GRADE_WEIGHT: Record<'hkd-r8' | 'kushiro-r3r7', Record<number, number>> = {
  'hkd-r8': { 4: 1, 3: 0.75, 2: 0.5, 1: 0.25 },
  'kushiro-r3r7': { 6: 1, 5: 0.9, 4: 0.8, 3: 0.6, 2: 0.4, 1: 0.2 },
}

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits

export function loadSourceFile(file: string): ZoneSourceFile {
  return JSON.parse(readFileSync(file, 'utf-8')) as ZoneSourceFile
}

export function buildZoneCollection(input: ZoneSourceFile): ZoneCollection {
  const parsed = SourceFile.safeParse(input)
  if (!parsed.success) {
    const where = parsed.error.issues.map((i) => {
      const path = i.path.map(String)
      const zoneIndex = path[0] === 'zones' ? Number(path[1]) : -1
      const zoneId = zoneIndex >= 0 ? (input.zones[zoneIndex]?.id ?? `#${String(zoneIndex)}`) : ''
      return `${zoneId ? `${zoneId}: ` : ''}${path.join('.')} ${i.message}`
    })
    throw new ZoneBuildError(`元データが不正です: ${where.join('; ')}`)
  }
  const { factors, zones, version } = parsed.data

  const ids = new Set<string>()
  const features: ZoneFeature[] = []
  for (const zone of [...zones].sort((a, b) => a.id.localeCompare(b.id))) {
    if (ids.has(zone.id)) throw new ZoneBuildError(`${zone.id}: id が重複しています`)
    ids.add(zone.id)
    const centerline = zone.centerline as LonLat[]
    const lengthKm = polylineLengthM(centerline) / 1000
    if (lengthKm < 1) {
      throw new ZoneBuildError(`${zone.id}: 長さが 1 km 未満です（${lengthKm.toFixed(2)} km）`)
    }
    const base = GRADE_WEIGHT[zone.grade.scale][zone.grade.level]
    if (base === undefined) {
      throw new ZoneBuildError(
        `${zone.id}: grade.level ${String(zone.grade.level)} は ${zone.grade.scale} に無い段階です`,
      )
    }
    const weights = factors.months.map((m) => ({
      dawn: round(base * m * factors.periods.dawn, 4),
      day: round(base * m * factors.periods.day, 4),
      dusk: round(base * m * factors.periods.dusk, 4),
      night: round(base * m * factors.periods.night, 4),
    }))
    features.push({
      type: 'Feature',
      id: zone.id,
      geometry: {
        type: 'Polygon',
        coordinates: [bufferPolyline(centerline, HALF_WIDTH_M) as [number, number][]],
      },
      properties: {
        id: zone.id,
        route: zone.route,
        roadName: zone.roadName,
        section: zone.section,
        grade: zone.grade,
        confidence: zone.confidence,
        lengthKm: round(lengthKm, 3),
        centerline: zone.centerline,
        weights,
        sources: zone.sources,
      },
    })
  }

  // 同じ路線で重なる・200 m 以内で続くゾーンは、元データで 1 つにまとめる（R5。判定を 1 ゾーン単位にするため）
  for (const a of features) {
    for (const b of features) {
      if (a === b || a.properties.route !== b.properties.route || a.id > b.id) continue
      const gap = Math.min(
        ...b.properties.centerline.map(
          (p) => distanceToPolyline(p, a.properties.centerline).distanceM,
        ),
        ...a.properties.centerline.map(
          (p) => distanceToPolyline(p, b.properties.centerline).distanceM,
        ),
      )
      if (gap <= MERGE_GAP_M + 2 * HALF_WIDTH_M) {
        throw new ZoneBuildError(
          `${b.id}: 同じ路線の ${a.id} と ${String(MERGE_GAP_M)} m 以内で続く・重なるので、元データで 1 つにまとめてください`,
        )
      }
    }
  }

  const hash = createHash('sha256').update(JSON.stringify(features)).digest('hex')
  const collection: ZoneCollection = {
    type: 'FeatureCollection',
    version,
    hash,
    factorSource: factors.source,
    features,
  }
  const check = ZoneCollectionSchema.safeParse(collection)
  if (!check.success) throw new ZoneBuildError(`生成物が不正です: ${check.error.message}`)
  return collection
}

/** ファイルに書く文字列（末尾の改行つき）。書き出しとテストの両方がこれを使う。 */
export function renderZoneCollection(collection: ZoneCollection): string {
  return `${JSON.stringify(collection)}\n`
}
