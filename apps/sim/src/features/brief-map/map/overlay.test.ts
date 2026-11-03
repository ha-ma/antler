import { describe, expect, it } from 'vitest'
import { personaDay, personaZoneDay } from '@/test/trip-day'
import { buildOverlay } from './overlay'
import { boundsOf, fitProjection } from './projection'

// 地図に重ねる SVG の形（docs/specs/brief-map/functional.md R9、UC-9a）

describe('buildOverlay', () => {
  const day = personaDay(personaZoneDay())
  const size = { width: 820, height: 480 }
  const project = fitProjection(boundsOf(day.legs.map((l) => l.route)), size, 48)
  const overlay = buildOverlay(day, project)

  it('UC-9a: ゾーンの帯は区間の数だけ、ゾーン内のルート（破線）も同じ数', () => {
    expect(day.zones.length).toBeGreaterThan(0)
    expect(overlay.bands).toHaveLength(day.zones.length)
    expect(overlay.routeInside).toHaveLength(day.zones.length)
    for (const d of [...overlay.bands, ...overlay.routeInside])
      expect(d).toMatch(/^M[\d.-]+ [\d.-]+( L[\d.-]+ [\d.-]+)+$/)
  })

  it('ゾーンの外のルートは移動ごとに区間の前後で切れる（区間の数 ＋ 移動の数）', () => {
    expect(overlay.routeOutside).toHaveLength(day.zones.length + day.legs.length)
  })

  it('地点は出発・到着（と経由）で、帯の名札は区間ごとに 1 つ、どれも枠の中', () => {
    expect(overlay.points[0]?.kind).toBe('depart')
    expect(overlay.points[overlay.points.length - 1]?.kind).toBe('arrive')
    expect(overlay.labels).toHaveLength(day.zones.length)
    for (const p of [...overlay.points, ...overlay.labels]) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(size.width)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(size.height)
    }
  })
})
