import { buildZoneCollection, type ZoneSourceFile } from '../scripts/zones-builder'
import type { LonLat } from './geo'

// テスト専用の合成ゾーン（実在の区間ではない）。index.ts からは export しない。
// A: 北緯 43° を東へ 4 km ほどの直線（R240）。B: 東経 144.2° を北へ 3.3 km ほど（R44）。

export const LINE_A: [number, number][] = [
  [144.0, 43.0],
  [144.025, 43.0],
  [144.05, 43.0],
]
export const LINE_B: [number, number][] = [
  [144.2, 43.0],
  [144.2, 43.03],
]

export const FLAT_FACTORS = {
  months: [0.2, 0.1, 0.2, 0.3, 0.3, 0.3, 0.3, 0.3, 0.4, 1, 0.8, 0.4],
  periods: { dawn: 0.2, day: 0.1, dusk: 1, night: 0.3 },
  source: { title: 'テスト用の係数', url: 'https://example.invalid/factors', license: 'テスト' },
}

const source = {
  title: 'テスト用の出典',
  url: 'https://example.invalid/map.pdf',
  license: '公共データ利用規約 1.0',
  period: 'R3-R7',
  modified: true,
}

export function testSourceFile(overrides: Partial<ZoneSourceFile> = {}): ZoneSourceFile {
  return {
    version: 1,
    factors: FLAT_FACTORS,
    zones: [
      {
        id: 'R240-test-1',
        route: 240,
        roadName: { ja: '国道240号', en: 'Route 240', zh: '240號國道', ko: '국도 240호' },
        section: { ja: 'テスト区間 A', en: 'Test section A' },
        grade: { scale: 'hkd-r8', level: 4, label: '100件以上' },
        confidence: 'high',
        sources: [source],
        centerline: LINE_A,
      },
      {
        id: 'R44-test-1',
        route: 44,
        roadName: { ja: '国道44号', en: 'Route 44', zh: '44號國道', ko: '국도 44호' },
        section: { ja: 'テスト区間 B', en: 'Test section B' },
        grade: { scale: 'kushiro-r3r7', level: 3, label: '41〜60件' },
        confidence: 'low',
        sources: [source],
        centerline: LINE_B,
      },
    ],
    ...overrides,
  }
}

export const TEST_ZONES = buildZoneCollection(testSourceFile())

const M_PER_DEG_LAT = 111_195
/** 点 [lon, lat] から北へ m メートル（負なら南）。 */
export function north(p: LonLat, m: number): LonLat {
  return [p[0], p[1] + m / M_PER_DEG_LAT]
}
/** 点 [lon, lat] から東へ m メートル（負なら西）。 */
export function east(p: LonLat, m: number): LonLat {
  return [p[0] + m / (M_PER_DEG_LAT * Math.cos((p[1] * Math.PI) / 180)), p[1]]
}
