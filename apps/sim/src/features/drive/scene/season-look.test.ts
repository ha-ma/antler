import { describe, expect, it } from 'vitest'
import { Color, type BufferGeometry } from 'three'
import type { LightPeriod } from '@antler/zones'
import type { Surface, Weather } from '../types'
import type { SceneSeason } from '../domain/season'
import { createRoadFrame } from '../domain/road'
import { demoScenario } from '../domain/scenario'
import { ZONES } from '../domain/zones-data'
import { BANK_HEIGHT_M, BANK_OUT_M, BANK_TOP_M, SHOULDER_EDGE_M, terrainHeight } from './layout'
import { SEASON, SKY, TERRAIN, TREE, WEATHER_FOG } from './palette'
import {
  RUT_CENTERS_M,
  buildRoadChunk,
  glossOf,
  roadCrossSection,
  roadMaterialParams,
} from './road-geometry'
import { buildForestGeometries } from './tree-models'
import {
  PRECIP_BOX,
  PRECIP_MAX,
  createPrecipField,
  insideCabin,
  stepPrecipField,
  vertexCount,
  writePrecipPositions,
} from './precip-field'
import { skyTargetOf } from './weather-look'

// drive-season R3・R6 の景色（UC-3b〜UC-3f）。色・横断面・材質・粒の動きを返す純粋関数を確かめる。
// 色は palette の定数と比べる（テストに色の値を書かない）。

const SEASONS: SceneSeason[] = ['winter', 'thaw', 'green', 'autumn', 'late-autumn']
const SURFACES: Surface[] = ['dry', 'wet', 'packed-snow', 'ice']
const PERIODS: LightPeriod[] = ['day', 'dawn', 'dusk', 'night']
const frame = createRoadFrame(demoScenario(ZONES).route)

const lightness = (hex: string) => new Color(hex).getHSL({ h: 0, s: 0, l: 0 }).l
/** 彩度の代わり: RGB の最大と最小の差（灰色ほど小さい） */
const spread = (hex: string) => {
  const c = new Color(hex)
  return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)
}

/** 形の頂点色に、色 hex に近い（距離 tol 未満）頂点があるか */
function hasColor(g: BufferGeometry, hex: string, tol = 0.03): boolean {
  const col = g.getAttribute('color')
  const c = new Color(hex)
  for (let i = 0; i < col.count; i++) {
    const d = Math.hypot(col.getX(i) - c.r, col.getY(i) - c.g, col.getZ(i) - c.b)
    if (d < tol) return true
  }
  return false
}

/** 形の頂点色に、明るさ（HSL の l）が min を超える頂点があるか */
function hasBright(g: BufferGeometry, min: number): boolean {
  const col = g.getAttribute('color')
  const c = new Color()
  const hsl = { h: 0, s: 0, l: 0 }
  for (let i = 0; i < col.count; i++) {
    c.setRGB(col.getX(i), col.getY(i), col.getZ(i))
    if (c.getHSL(hsl).l > min) return true
  }
  return false
}

describe('UC-3b: 季節の地面・路肩・法面', () => {
  it('UC-3b: 季節ごとに地面・路肩・法面の色が違い、冬だけ法面が雪の色', () => {
    for (const key of ['ground', 'shoulder', 'bank'] as const) {
      expect(new Set(SEASONS.map((s) => SEASON[s][key])).size).toBe(SEASONS.length)
    }
    for (const s of SEASONS) {
      const banks = roadCrossSection('dry', s).filter((x) => x.kind === 'bank')
      expect(banks.length).toBe(4)
      for (const b of banks) expect(b.color).toBe(SEASON[s].bank)
      expect(SEASON[s].bank === TERRAIN.snowBank).toBe(s === 'winter')
    }
    // 雪どけは汚れた残雪（冬より暗く、草の法面より明るい）。緑・紅葉・初冬は草の法面
    expect(SEASON.thaw.bankSnow).toBe(true)
    expect(lightness(SEASON.thaw.bank)).toBeLessThan(lightness(SEASON.winter.bank))
    for (const s of ['green', 'autumn', 'late-autumn'] as const) {
      expect(SEASON[s].bankSnow).toBe(false)
      expect(lightness(SEASON[s].bank)).toBeLessThan(lightness(SEASON.thaw.bank))
    }
  })

  it('UC-3b: 法面の高さは季節で同じ（鹿の足の高さ terrainHeight と横断面が合う）', () => {
    const shape = (s: SceneSeason) =>
      roadCrossSection('dry', s)
        .filter((x) => x.kind === 'bank' || x.kind === 'shoulder')
        .map(({ d0, d1, y0, y1 }) => [d0, d1, y0, y1])
    for (const s of SEASONS) expect(shape(s)).toEqual(shape('winter'))
    const top = roadCrossSection('dry', 'green').find(
      (x) => x.kind === 'bank' && x.d0 === SHOULDER_EDGE_M,
    )
    expect(top?.d1).toBe(BANK_TOP_M)
    expect(top?.y1).toBe(BANK_HEIGHT_M)
    expect(terrainHeight(BANK_TOP_M)).toBeCloseTo(BANK_HEIGHT_M, 9)
    expect(terrainHeight(BANK_OUT_M)).toBe(0)
  })
})

describe('UC-3c: 路面の車道', () => {
  it('UC-3c: 圧雪は轍の帯が 4 本（左右の車線の車輪の位置）、ほかの路面は轍が無い', () => {
    for (const surface of SURFACES) {
      const ruts = roadCrossSection(surface, 'winter').filter((x) => x.kind === 'rut')
      if (surface !== 'packed-snow') {
        expect(ruts).toHaveLength(0)
        continue
      }
      expect(ruts).toHaveLength(4)
      const centers = ruts.map((r) => (r.d0 + r.d1) / 2).sort((a, b) => a - b)
      const want = [...RUT_CENTERS_M.map((c) => -c), ...RUT_CENTERS_M].sort((a, b) => a - b)
      centers.forEach((c, i) => expect(c).toBeCloseTo(want[i] ?? NaN, 9))
      // 左車線（d < 0）に 2 本、右車線に 2 本
      expect(centers.filter((c) => c < 0)).toHaveLength(2)
      // 轍は車道より暗い
      for (const r of ruts)
        expect(lightness(r.color)).toBeLessThan(
          lightness(
            roadCrossSection(surface, 'winter').find((x) => x.kind === 'road')?.color ?? '',
          ),
        )
    }
  })

  it('UC-3c: 圧雪の中央線・外側線はかすれる（路面の色に寄る）。乾燥の線はくっきり', () => {
    const lines = (surface: Surface) =>
      roadCrossSection(surface, 'winter').filter((x) => x.kind === 'line')
    const contrast = (surface: Surface) => {
      const road = roadCrossSection(surface, 'winter').find((x) => x.kind === 'road')?.color ?? ''
      return Math.max(...lines(surface).map((l) => Math.abs(lightness(l.color) - lightness(road))))
    }
    expect(lines('dry').map((l) => l.color)).toContain(
      `#${new Color(TERRAIN.edgeLine).getHexString()}`,
    )
    expect(lines('packed-snow')).toHaveLength(3)
    expect(contrast('packed-snow')).toBeLessThan(contrast('dry') * 0.5)
  })

  it('UC-3c: 車道は路面で色が違い、横断面の帯は車道の幅をすき間なく埋める', () => {
    const roadColor = (surface: Surface) =>
      roadCrossSection(surface, 'winter').find((x) => x.kind === 'road')?.color
    expect(new Set(SURFACES.map(roadColor)).size).toBe(4)
    for (const surface of SURFACES) {
      const pave = roadCrossSection(surface, 'green')
        .filter((x) => x.kind === 'road' || x.kind === 'rut')
        .sort((a, b) => a.d0 - b.d0)
      for (let i = 1; i < pave.length; i++)
        expect(pave[i]?.d0).toBeCloseTo(pave[i - 1]?.d1 ?? NaN, 9)
    }
    // 形は季節・路面を変えても作れて、頂点色の数が頂点の数と同じ
    const c = buildRoadChunk(frame, 2, 'packed-snow', 'green')
    expect(c.geometry.getAttribute('color').count).toBe(c.geometry.getAttribute('position').count)
  })

  it('UC-3c: 濡れと凍結は光沢のある材質（照り返し）、乾燥と圧雪は光沢が弱い', () => {
    const glossy = (s: Surface) => roadMaterialParams(s)
    for (const shiny of ['wet', 'ice'] as const) {
      for (const matte of ['dry', 'packed-snow'] as const) {
        expect(glossy(shiny).shininess).toBeGreaterThan(glossy(matte).shininess * 5)
        expect(lightness(glossy(shiny).specular)).toBeGreaterThan(
          lightness(glossy(matte).specular) * 3,
        )
      }
      // 浅い角度で空を映す（フレネル）のは濡れと凍結だけ
      expect(glossy(shiny).skyReflect).toBeGreaterThan(0.3)
    }
    expect(glossy('dry').skyReflect).toBe(0)
    expect(glossy('packed-snow').skyReflect).toBe(0)
    // 照り返すのは車道・轍・線だけ（濡れた草の法面や路肩は光らない）
    const c = buildRoadChunk(frame, 2, 'wet', 'green')
    const gloss = c.geometry.getAttribute('gloss')
    expect(gloss.count).toBe(c.geometry.getAttribute('position').count)
    for (const strip of roadCrossSection('wet', 'green'))
      expect(glossOf(strip.kind)).toBe(strip.kind === 'shoulder' || strip.kind === 'bank' ? 0 : 1)
    // 濡れは乾燥より暗い。凍結は青白い（青が強い）
    expect(lightness(roadCrossSection('wet', 'green')[0]?.color ?? '')).toBeLessThan(
      lightness(roadCrossSection('dry', 'green')[0]?.color ?? ''),
    )
    const ice = new Color(roadCrossSection('ice', 'winter')[0]?.color)
    expect(ice.b).toBeGreaterThan(ice.r)
  })
})

describe('UC-3d: 木', () => {
  it('UC-3d: 冬だけ針葉樹の先に雪。緑と紅葉は広葉樹に葉（紅葉は黄・橙）、ほかは葉なし', () => {
    for (const season of SEASONS) {
      const g = buildForestGeometries(season)
      expect(Object.keys(g).sort()).toEqual(['arrow', 'bare', 'birch', 'conifer'])
      // 雪の先は雪の色へ 85% 寄る（明るい頂点がある）。雪の無い針葉樹は濃い緑と幹だけ
      expect(hasBright(g.conifer, lightness(TREE.coniferSnow) * 0.7)).toBe(season === 'winter')
      const green = season === 'green'
      const autumn = season === 'autumn'
      expect(hasColor(g.bare, TREE.leafOak)).toBe(green)
      expect(hasColor(g.birch, TREE.leafBirch)).toBe(green)
      // 紅葉: ミズナラは橙、シラカバは黄
      expect(hasColor(g.bare, TREE.autumnOak)).toBe(autumn)
      expect(hasColor(g.birch, TREE.autumnBirch)).toBe(autumn)
      for (const kind of ['bare', 'birch', 'conifer'] as const) g[kind].dispose()
    }
  })

  it('UC-3d・R6: 葉を付けても木 1 本の三角形は 150 以下（葉なしの 4 倍以下）', () => {
    const tris = (g: BufferGeometry) => g.getAttribute('position').count / 3
    const bare = buildForestGeometries('winter')
    const leafy = buildForestGeometries('green')
    for (const kind of ['bare', 'birch'] as const) {
      expect(tris(leafy[kind])).toBeLessThanOrEqual(150)
      expect(tris(leafy[kind])).toBeLessThanOrEqual(tris(bare[kind]) * 4)
    }
    expect(tris(leafy.conifer)).toBe(tris(bare.conifer))
  })
})

describe('UC-3e: 降るもの', () => {
  it('UC-3e・R6: 粒の数は上限（雪 2,000・雨 1,500）以下で、同じシードなら同じ', () => {
    expect(PRECIP_MAX.snow).toBeLessThanOrEqual(2000)
    expect(PRECIP_MAX.rain).toBeLessThanOrEqual(1500)
    const a = createPrecipField('snow', 918273)
    expect(a.count).toBe(PRECIP_MAX.snow)
    expect(createPrecipField('rain', 1, 99_999).count).toBe(PRECIP_MAX.rain)
    expect(Array.from(createPrecipField('snow', 918273).pos)).toEqual(Array.from(a.pos))
    expect(Array.from(createPrecipField('snow', 1).pos)).not.toEqual(Array.from(a.pos))
    // 描画の頂点: 雪は粒 1 つに 1 頂点、雨は筋 1 本に 2 頂点
    expect(vertexCount(a)).toBe(a.count)
    expect(vertexCount(createPrecipField('rain', 1))).toBe(PRECIP_MAX.rain * 2)
  })

  it('UC-3e: 100 km/h で 60 秒走っても、粒は車の周りの箱に留まり、車内には描かない', () => {
    for (const kind of ['snow', 'rain'] as const) {
      const f = createPrecipField(kind, 42)
      const box = PRECIP_BOX[kind]
      const speed = 100 / 3.6
      for (let i = 0; i < 60 * 60; i++) stepPrecipField(f, 1 / 60, speed / 60)
      let ahead = 0
      for (let i = 0; i < f.count; i++) {
        const [x, y, z] = [f.pos[i * 3] ?? NaN, f.pos[i * 3 + 1] ?? NaN, f.pos[i * 3 + 2] ?? NaN]
        expect(x).toBeGreaterThanOrEqual(box.x[0])
        expect(x).toBeLessThan(box.x[1])
        expect(y).toBeGreaterThanOrEqual(box.y[0])
        expect(y).toBeLessThan(box.y[1])
        expect(z).toBeGreaterThanOrEqual(box.z[0])
        expect(z).toBeLessThan(box.z[1])
        if (z < -10) ahead++
      }
      // 前に粒が残っている（後ろに溜まらない）
      expect(ahead / f.count).toBeGreaterThan(0.5)
      // 車内の粒は地面の下へ外す
      const out = new Float32Array(vertexCount(f) * 3)
      writePrecipPositions(f, speed, out)
      const stride = kind === 'snow' ? 3 : 6
      for (let i = 0; i < f.count; i++) {
        const o = i * stride
        expect(insideCabin(out[o] ?? 0, out[o + 1] ?? 0, out[o + 2] ?? 0)).toBe(false)
      }
    }
  })

  it('UC-3e: 雨の筋は走ると手前へ傾く（止まっていれば真下）', () => {
    const f = createPrecipField('rain', 7, 10)
    const still = new Float32Array(vertexCount(f) * 3)
    writePrecipPositions(f, 0, still)
    expect(still[5]).toBeCloseTo(still[2] ?? NaN, 6)
    const moving = new Float32Array(vertexCount(f) * 3)
    writePrecipPositions(f, 25, moving)
    // 上の端は前（-Z）にある
    expect(moving[5] ?? 0).toBeLessThan((moving[2] ?? 0) - 0.1)
  })
})

describe('UC-3f: 空とフォグ', () => {
  it('UC-3f: 曇り・雨・雪・霧の空は晴れより灰色に寄る（どの光の区分でも）', () => {
    for (const period of PERIODS) {
      const clear = skyTargetOf(period, 'clear')
      expect(clear.zenith).toBe(`#${new Color(SKY[period].zenith).getHexString()}`)
      for (const w of ['cloudy', 'rain', 'snow', 'fog'] as Weather[]) {
        const sky = skyTargetOf(period, w)
        expect(spread(sky.zenith)).toBeLessThan(spread(clear.zenith))
        expect(spread(sky.horizon)).toBeLessThanOrEqual(spread(clear.horizon) + 1e-9)
        expect(sky.sunIntensity).toBeLessThan(clear.sunIntensity + 1e-9)
      }
    }
  })

  it('UC-3f: 霧の far は天候の係数で短い（雨の係数 0.7 がある）', () => {
    expect(WEATHER_FOG.rain).toBe(0.7)
    for (const period of PERIODS) {
      const far = (w: Weather) => skyTargetOf(period, w).fogFar
      expect(far('clear')).toBe(SKY[period].fogFar)
      expect(far('rain')).toBeCloseTo(SKY[period].fogFar * 0.7, 9)
      expect(far('fog')).toBeLessThan(far('snow'))
      expect(far('snow')).toBeLessThan(far('rain'))
      expect(far('rain')).toBeLessThan(far('cloudy'))
    }
  })
})
