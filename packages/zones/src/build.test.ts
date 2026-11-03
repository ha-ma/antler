import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  buildZoneCollection,
  loadSourceFile,
  renderZoneCollection,
  ZoneBuildError,
} from '../scripts/zones-builder'
import { verifyZoneHash } from './data'
import { bufferPolyline, distanceToPolyline, fromLocal } from './geo'
import { ZoneCollectionSchema } from './zone-db'
import { LINE_A, testSourceFile } from './test-zones'

const here = path.dirname(fileURLToPath(import.meta.url))

describe('UC-1 ゾーン DB の生成', () => {
  it('UC-1a: 正しい元データ → FeatureCollection。geometry は中心線を片側 150 m 膨らませたポリゴン、properties に中心線', () => {
    const fc = buildZoneCollection(testSourceFile())
    expect(ZoneCollectionSchema.safeParse(fc).success).toBe(true)
    const a = fc.features.find((f) => f.properties.id === 'R240-test-1')
    expect(a?.geometry.type).toBe('Polygon')
    expect(a?.properties.centerline).toEqual(LINE_A)
    for (const p of a?.geometry.coordinates[0] ?? []) {
      const d = distanceToPolyline(p, LINE_A).distanceM
      expect(d).toBeGreaterThan(148)
      expect(d).toBeLessThan(152)
    }
    expect(a?.properties.lengthKm).toBeCloseTo(4.07, 1)
  })

  it('UC-1b: 出典が空・長さ 1 km 未満・id の形が違う・重みが範囲外 → 失敗し、どのゾーンのどの項目かを示す', () => {
    const base = testSourceFile()
    const zone0 = base.zones[0]
    if (!zone0) throw new Error('見本が空')
    const cases: [string, ReturnType<typeof testSourceFile>, RegExp][] = [
      ['出典が空', { ...base, zones: [{ ...zone0, sources: [] }] }, /R240-test-1.*sources/],
      [
        '1 km 未満',
        {
          ...base,
          zones: [
            {
              ...zone0,
              centerline: [
                [144.0, 43.0],
                [144.005, 43.0],
              ],
            },
          ],
        },
        /R240-test-1.*1 km/,
      ],
      ['id の形', { ...base, zones: [{ ...zone0, id: 'route 240' }] }, /id/],
      [
        '係数が範囲外',
        { ...base, factors: { ...base.factors, periods: { ...base.factors.periods, dusk: 1.5 } } },
        /factors/,
      ],
    ]
    for (const [label, file, message] of cases) {
      expect(() => buildZoneCollection(file), label).toThrow(ZoneBuildError)
      expect(() => buildZoneCollection(file), label).toThrow(message)
    }
  })

  it('UC-3c（生成側）: 同じ路線で重なる・200 m 以内で続くゾーンは失敗する（元データで 1 つにまとめる）', () => {
    const base = testSourceFile()
    const zone0 = base.zones[0]
    if (!zone0) throw new Error('見本が空')
    const next = {
      ...zone0,
      id: 'R240-test-2',
      centerline: [
        [144.0515, 43.0],
        [144.08, 43.0],
      ] as [number, number][],
    }
    expect(() => buildZoneCollection({ ...base, zones: [zone0, next] })).toThrow(
      /R240-test-2.*200 m/,
    )
  })

  it('UC-3h: [ADDED code-reviewer] 同じ路線の 2 本が線分の途中で交わる（頂点どうしは遠い）ときも失敗する', () => {
    const base = testSourceFile()
    const zone0 = base.zones[0]
    if (!zone0) throw new Error('見本が空')
    const northSouth = {
      ...zone0,
      centerline: [
        [144.0, 42.98],
        [144.0, 43.02],
      ] as [number, number][],
    }
    const eastWest = {
      ...zone0,
      id: 'R240-test-2',
      centerline: [
        [143.97, 43.0],
        [144.03, 43.0],
      ] as [number, number][],
    }
    expect(() => buildZoneCollection({ ...base, zones: [northSouth, eastWest] })).toThrow(
      /R240-test-2.*200 m/,
    )
  })

  it('UC-1f: [ADDED code-reviewer] 長さの違う線分の角でも、輪郭は中心線から 150 m を保つ（角の向きを二等分線にする）', () => {
    const origin: [number, number] = [144.0, 43.0]
    const line = [
      [0, 0],
      [1000, 0],
      [1000 + 400 * Math.SQRT1_2, 400 * Math.SQRT1_2],
    ].map((v) => fromLocal(origin, v as [number, number]))
    for (const p of bufferPolyline(line, 150)) {
      expect(distanceToPolyline(p, line).distanceM).toBeGreaterThan(148)
    }
  })

  it('UC-1c: 同じ元データから 2 回作ると同じバイト列。hash は features の sha256', () => {
    const a = renderZoneCollection(buildZoneCollection(testSourceFile()))
    const b = renderZoneCollection(buildZoneCollection(testSourceFile()))
    expect(a).toBe(b)
    expect(JSON.parse(a).hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('UC-1d / AC-2: 書き出した zones.geojson が生成スクリプトの出力と一致し、全ゾーンが検証を通る', () => {
    const source = loadSourceFile(path.resolve(here, '../data/zones.source.json'))
    const committed = readFileSync(path.resolve(here, '../data/zones.geojson'), 'utf-8')
    expect(committed, 'npm run build:zones -w @antler/zones').toBe(
      renderZoneCollection(buildZoneCollection(source)),
    )
    const parsed = ZoneCollectionSchema.safeParse(JSON.parse(committed))
    expect(parsed.success).toBe(true)
    expect(Buffer.byteLength(committed)).toBeLessThan(500 * 1024)
  })

  it('UC-1e: [ADDED alert-contract-guard] verifyZoneHash は features から計算し直した sha256 と照合し、手で直したファイルを見つける', async () => {
    const committed = readFileSync(path.resolve(here, '../data/zones.geojson'), 'utf-8')
    expect(await verifyZoneHash(committed)).toBe(true)
    const tampered = JSON.parse(committed) as { features: { properties: { lengthKm: number } }[] }
    const first = tampered.features[0]
    if (first) first.properties.lengthKm += 1
    expect(await verifyZoneHash(tampered)).toBe(false)
    expect(await verifyZoneHash('{}')).toBe(false)
  })
})
