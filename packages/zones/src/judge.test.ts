import { describe, expect, it } from 'vitest'
import { judgeZone, toGpsZone, type Fix, type ZoneJudgement } from './judge'
import { buildZoneCollection } from '../scripts/zones-builder'
import { east, LINE_A, north, TEST_ZONES, testSourceFile } from './test-zones'

const T = Date.parse('2027-02-15T16:00:00+09:00')
const mid = LINE_A[1] as [number, number] // 区間 A の中ほど

const fixAt = (p: readonly [number, number], over: Partial<Fix> = {}): Fix => ({
  lon: p[0],
  lat: p[1],
  accuracyM: 10,
  timestamp: T,
  ...over,
})

const judge = (fix: Fix | null, previous: ZoneJudgement | null = null, now = T) =>
  judgeZone({ fix, now, previous, zones: TEST_ZONES })

describe('UC-2 ゾーンの内外（judgeZone）', () => {
  it('UC-2a: 中心線から 149・150 m → inside、151 m（前回 outside）→ outside', () => {
    expect(judge(fixAt(north(mid, 149))).status).toBe('inside')
    expect(judge(fixAt(north(mid, 150))).status).toBe('inside')
    const outside = judge(fixAt(north(mid, 2000)))
    expect(judge(fixAt(north(mid, 151)), outside).status).toBe('outside')
  })

  it('UC-2b: 前回 inside なら 200 m までは inside、201 m で outside。149 → 151 → 149 m で enterZone は 1 回', () => {
    const inside = judge(fixAt(north(mid, 100)))
    expect(judge(fixAt(north(mid, 200)), inside).status).toBe('inside')
    expect(judge(fixAt(north(mid, 201)), inside).status).toBe('outside')
    let prev: ZoneJudgement | null = judge(fixAt(north(mid, 2000)))
    let enters = 0
    for (const m of [149, 151, 149, 151, 149]) {
      prev = judge(fixAt(north(mid, m)), prev)
      if (prev.enterZone) enters += 1
    }
    expect(enters).toBe(1)
  })

  it('UC-2i: [ADDED alert-contract-guard] inside → unknown（測位の欠け）→ 180 m でも inside のまま（出口側の猶予を保つ）', () => {
    const inside = judge(fixAt(north(mid, 100)))
    const lost = judge(null, inside)
    expect(judge(fixAt(north(mid, 180)), lost).status).toBe('inside')
    expect(judge(fixAt(north(mid, 201)), lost).status).toBe('outside')
  })

  it('UC-2l: [ADDED code-reviewer] 隣の別路線のゾーンの方が近くても、入っていたゾーンの出口側の猶予（200 m）を保ち、enterZone を立て直さない', () => {
    const base = testSourceFile()
    const [zoneA, zoneB] = base.zones
    if (!zoneA || !zoneB) throw new Error('見本が足りない')
    // A の 340 m 北を並行して走る別路線
    const parallel = {
      ...zoneB,
      centerline: LINE_A.map((p) => [...north(p, 340)] as [number, number]),
    }
    const zones = buildZoneCollection({ ...base, zones: [zoneA, parallel] })
    const step = (fix: Fix, previous: ZoneJudgement | null) =>
      judgeZone({ fix, now: T, previous, zones })
    const inside = step(fixAt(north(mid, 100)), null)
    expect(inside.zoneId).toBe('R240-test-1')
    // A から 180 m・隣から 160 m
    const between = step(fixAt(north(mid, 180)), inside)
    expect(between.status).toBe('inside')
    expect(between.zoneId).toBe('R240-test-1')
    expect(between.enterZone).toBe(false)
  })

  it('UC-2c: 東へ 150 m と北へ 150 m がどちらも inside（メートルで測る）', () => {
    const end = LINE_A[2] as [number, number]
    expect(judge(fixAt(east(end, 150))).status).toBe('inside')
    expect(judge(fixAt(north(mid, 150))).status).toBe('inside')
    expect(judge(fixAt(east(end, 160))).status).toBe('outside')
  })

  it('UC-2d: 誤差 300 m で中心線から 400 m → inside（円が重なる）、600 m → unknown', () => {
    expect(judge(fixAt(north(mid, 400), { accuracyM: 300 })).status).toBe('inside')
    expect(judge(fixAt(north(mid, 600), { accuracyM: 300 })).status).toBe('unknown')
  })

  it('UC-2e: 10 秒より古い測位・位置なし・北海道の外 → unknown', () => {
    expect(judge(fixAt(mid, { timestamp: T - 10_001 })).status).toBe('unknown')
    expect(judge(fixAt(mid, { timestamp: T - 10_000 })).status).toBe('inside')
    expect(judge(null).status).toBe('unknown')
    expect(judge(fixAt([139.69, 35.68])).status).toBe('unknown')
  })

  it('UC-2f: outside のとき、いちばん近いゾーンまでの直線距離（ゾーンの縁まで）と路線名', () => {
    const r = judge(fixAt(north(mid, 2150)))
    expect(r.status).toBe('outside')
    expect(r.zoneId).toBe('R240-test-1')
    expect(r.distanceKm).toBeCloseTo(2.0, 2)
    expect(r.roadName?.ja).toBe('国道240号')
    expect(r.roadName?.zh).toBe('240號國道')
  })

  it('UC-2g: 到達予定は距離 ÷ 速度（JST）。時速 5 km 未満・速度なし → なし', () => {
    const fast = judge(fixAt(north(mid, 10_150), { speedMps: 50 / 3.6 }))
    expect(fast.distanceKm).toBeCloseTo(10, 1)
    expect(fast.eta).toBe('2027-02-15T16:12:00.000+09:00')
    expect(judge(fixAt(north(mid, 10_150), { speedMps: 4 / 3.6 })).eta).toBeUndefined()
    expect(judge(fixAt(north(mid, 10_150))).eta).toBeUndefined()
  })

  it('UC-2h: ゾーンの中から始まる（前回なし）→ enterZone が立つ。inside → unknown → inside では立たない', () => {
    const first = judge(fixAt(mid))
    expect(first).toMatchObject({ status: 'inside', zoneId: 'R240-test-1', enterZone: true })
    const lost = judge(null, first)
    expect(lost.status).toBe('unknown')
    expect(judge(fixAt(mid), lost).enterZone).toBe(false)
  })

  it('inside の残り km は進む向きで決まる（向きが分からなければ長い方＝安全側）', () => {
    const west = LINE_A[0] as [number, number]
    const first = judge(fixAt(east(west, 1000)))
    expect(first.remainingKm).toBeCloseTo(3.07, 1)
    const forward = judge(fixAt(east(west, 1500)), first)
    expect(forward.remainingKm).toBeCloseTo(2.57, 1)
    const back = judge(fixAt(east(west, 500)), first)
    expect(back.remainingKm).toBeCloseTo(0.5, 1)
  })

  it('toGpsZone は alert-ui の GpsZone の形に直す', () => {
    expect(toGpsZone(judge(fixAt(mid)))).toMatchObject({ status: 'inside' })
    expect(toGpsZone(judge(fixAt(north(mid, 2150))))).toMatchObject({
      status: 'outside',
      distanceKm: expect.closeTo(2.0, 2) as unknown as number,
    })
    expect(toGpsZone(judge(null))).toEqual({ status: 'unknown' })
  })
})

describe('レビューで足したもの（code-reviewer）', () => {
  it('UC-4b: [ADDED code-reviewer] トンネルを抜けた直後（inside → unknown → 出口の先で outside）に、同じゾーンを通過にも数えない（二重計上しない）', () => {
    const west = LINE_A[0] as [number, number]
    const inside = judge(fixAt(east(west, 3000)))
    const lost = judge(null, inside)
    const after = judge(fixAt(east(west, 5000), { timestamp: T + 5000 }), lost, T + 5000)
    expect(after.status).toBe('outside')
    expect(after.passages).toEqual([])
  })

  it('UC-2j: [ADDED code-reviewer] 止まっていて GPS が揺れても、残り km の向きは反転しない（5 m 未満の動きでは向きを保つ）', () => {
    const west = LINE_A[0] as [number, number]
    const a = judge(fixAt(east(west, 1000)))
    const b = judge(fixAt(east(west, 1500)), a)
    expect(b.remainingKm).toBeCloseTo(2.57, 1)
    const jitter = judge(fixAt(east(west, 1497)), b)
    expect(jitter.remainingKm).toBeCloseTo(2.57, 1)
  })

  it('UC-2k: [ADDED code-reviewer] 誤差が 1 km を超える・時刻や誤差が NaN → unknown', () => {
    expect(judge(fixAt(mid, { accuracyM: 1500 })).status).toBe('unknown')
    expect(judge(fixAt(mid, { accuracyM: Number.NaN })).status).toBe('unknown')
    expect(judge(fixAt(mid, { timestamp: Number.NaN })).status).toBe('unknown')
  })

  it('UC-4c: [ADDED code-reviewer] 2 分より長い空白のあいだの直線は通過に数えない（実際の道筋が分からない）', () => {
    const before = judge(fixAt(north(mid, -1000)))
    const later = T + 121_000
    const after = judge(fixAt(north(mid, 1000), { timestamp: later }), before, later)
    expect(after.passages).toEqual([])
  })
})

describe('UC-4 測位の途切れ', () => {
  it('UC-4a: 前回がゾーンの手前 1 km、今回が先 1 km → 通過 1 回、enterZone は立たない', () => {
    const before = judge(fixAt(north(mid, -1000)))
    const after = judge(fixAt(north(mid, 1000), { timestamp: T + 5000 }), before, T + 5000)
    expect(after.status).toBe('outside')
    expect(after.passages).toEqual(['R240-test-1'])
    expect(after.enterZone).toBe(false)
  })

  it('ゾーンをかすめない移動では通過に数えない', () => {
    const before = judge(fixAt(north(mid, 1000)))
    const after = judge(
      fixAt(east(north(mid, 1000), 500), { timestamp: T + 5000 }),
      before,
      T + 5000,
    )
    expect(after.passages).toEqual([])
  })
})
