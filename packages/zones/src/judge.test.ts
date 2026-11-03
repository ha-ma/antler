import { describe, expect, it } from 'vitest'
import { judgeZone, toGpsZone, type Fix, type ZoneJudgement } from './judge'
import { east, LINE_A, north, TEST_ZONES } from './test-zones'

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
