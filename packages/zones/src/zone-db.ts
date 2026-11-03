import { z } from 'zod'

// ゾーン DB（zones.geojson）の形（functional.md R1）。生成スクリプトが書き、A と B が読む。

export const LIGHT_PERIODS = ['dawn', 'day', 'dusk', 'night'] as const
export type LightPeriod = (typeof LIGHT_PERIODS)[number]

/** ゾーンの id。Capture.roadSegment にそのまま入る（英数字とハイフン）。例 R240-akan-1 */
export const ZONE_ID = /^R[0-9]{1,3}(?:-[a-z]+)+-[0-9]+$/

const Unit = z.number().min(0).max(1)
const Coord = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])

export const ZoneSourceRef = z.strictObject({
  title: z.string().min(1),
  url: z.string().url(),
  license: z.string().min(1),
  period: z.string().min(1).optional(),
  /** 元の資料を加工して作成したか（公共データ利用規約で表示が要る） */
  modified: z.boolean(),
})

export const LocalizedRoad = z.strictObject({
  ja: z.string().min(1),
  en: z.string().min(1),
  zh: z.string().min(1),
  ko: z.string().min(1),
})

export const ZoneProperties = z.strictObject({
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
  lengthKm: z.number().min(1),
  centerline: z.array(Coord).min(2),
  /** 月（1〜12 月 = 0〜11）× 光の区分の危険度（0〜1） */
  weights: z.array(z.strictObject({ dawn: Unit, day: Unit, dusk: Unit, night: Unit })).length(12),
  sources: z.array(ZoneSourceRef).min(1),
})
export type ZoneProperties = z.infer<typeof ZoneProperties>

export const ZoneFeature = z.strictObject({
  type: z.literal('Feature'),
  id: z.string().regex(ZONE_ID),
  geometry: z.strictObject({
    type: z.literal('Polygon'),
    coordinates: z.array(z.array(Coord).min(4)).length(1),
  }),
  properties: ZoneProperties,
})
export type ZoneFeature = z.infer<typeof ZoneFeature>

export const ZoneCollectionSchema = z.strictObject({
  type: z.literal('FeatureCollection'),
  version: z.number().int().min(1),
  /** features の JSON の sha256（A と B が同じファイルを使っているかの確認用） */
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  /** 月 × 光の区分の係数の出典（重み表の根拠） */
  factorSource: ZoneSourceRef.omit({ modified: true, period: true }),
  features: z.array(ZoneFeature),
})
export type ZoneCollection = z.infer<typeof ZoneCollectionSchema>
