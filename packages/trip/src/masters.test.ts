import { inHokkaido } from '@antler/zones'
import { describe, expect, it } from 'vitest'
import { AREA_CIRCUIT, DEPARTURE_PLACE_ID, PLACES, placeById } from './places'
import { PLEASURES, pleasureById, pleasuresInArea } from './pleasures'
import type { Area } from './types'

const AREAS: Area[] = ['doto', 'doo']
const LANGS = ['ja', 'en', 'zh', 'ko'] as const

describe('UC-2a マスター', () => {
  for (const area of AREAS) {
    it(`${area}: 12 件以上で、4 言語の名称と補足がそろい、id が重複しない`, () => {
      const list = pleasuresInArea(area)
      expect(list.length).toBeGreaterThanOrEqual(12)
      for (const p of list) {
        for (const l of LANGS) {
          expect(p.name[l].trim()).not.toBe('')
          expect(p.note[l].trim()).not.toBe('')
        }
      }
    })
  }

  it('楽しみの id は全体で重複しない', () => {
    const ids = PLEASURES.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('地点の id は重複しない', () => {
    const ids = PLACES.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('固定の id と、時間帯・事実確認の初期値', () => {
    expect(pleasureById('drift-ice-walk')?.area).toBe('doto')
    expect(pleasureById('red-crowned-crane')?.area).toBe('doto')
    expect(pleasureById('nosappu-sunrise')?.timeOfDay).toBe('dawn')
    expect(pleasureById('akan-ainu-kotan')?.timeOfDay).toBe('night')
    expect(PLEASURES.every((p) => !p.verified)).toBe(true)
  })

  it('補足に数字の統計（件数・金額）や絵文字を書かない', () => {
    for (const p of PLEASURES) {
      for (const l of LANGS) {
        expect(p.note[l]).not.toMatch(/万円|件|\p{Extended_Pictographic}/u)
      }
    }
  })
})

describe('地点と周回', () => {
  it('すべての楽しみの base は PLACES にあり、そのエリアの周回に含まれる', () => {
    for (const p of PLEASURES) {
      const base = placeById(p.base)
      expect(base, `${p.id} の base ${p.base}`).toBeDefined()
      expect(base?.kind).toBe('base')
      expect(base?.area).toBe(p.area)
      expect(AREA_CIRCUIT[p.area]).toContain(p.base)
    }
  })

  it('周回は PLACES の拠点だけで、重複せず、そのエリアの拠点をすべて含む', () => {
    for (const area of AREAS) {
      const circuit = AREA_CIRCUIT[area]
      expect(new Set(circuit).size).toBe(circuit.length)
      for (const id of circuit) expect(placeById(id)?.area).toBe(area)
      const bases = PLACES.filter((p) => p.kind === 'base' && p.area === area).map((p) => p.id)
      expect([...circuit].sort()).toEqual([...bases].sort())
    }
  })

  it('DEPARTURE_PLACE_ID の値はすべて PLACES の玄関口にある', () => {
    for (const id of Object.values(DEPARTURE_PLACE_ID)) {
      expect(placeById(id)?.kind).toBe('gateway')
    }
    expect(Object.keys(DEPARTURE_PLACE_ID).sort()).toEqual(['AKJ', 'CTS', 'HKD', 'KUH', 'SAPPORO'])
  })

  it('座標は北海道の範囲にあり、名称は 4 言語そろう', () => {
    for (const p of PLACES) {
      expect(inHokkaido([p.lon, p.lat]), p.id).toBe(true)
      for (const l of LANGS) expect(p.name[l].trim()).not.toBe('')
    }
  })
})
