import type { CollisionDescriptor, LossDayContext } from '../models/loss.js'
import { buildLossBrief, checkCollision, lossKeyMaterial } from './collision-policy.js'

// docs/specs/loss/functional.md R5〜R7（UC-5a・UC-6b・IDEM-1・IDEM-2）

const L = (ja: string) => ({ ja, en: `${ja}-en`, zh: `${ja}-zh`, ko: `${ja}-ko` })

/** 4 日の旅: D1 cts→tsurui、D2 tsurui→akan→utoro（タンチョウは tsurui、温泉は akan）、D3 移動なし（流氷）、D4 utoro→cts */
const DAYS: LossDayContext[] = [
  {
    day: 1,
    date: '2027-02-14',
    legs: [{ fromId: 'cts', from: L('新千歳'), to: L('鶴居') }],
    stops: [],
    stay: L('鶴居'),
  },
  {
    day: 2,
    date: '2027-02-15',
    legs: [
      { fromId: 'tsurui', from: L('鶴居'), to: L('阿寒') },
      { fromId: 'akan', from: L('阿寒'), to: L('ウトロ') },
    ],
    stops: [
      { id: 'red-crowned-crane', base: 'tsurui', name: L('タンチョウ') },
      { id: 'akan-onsen-snow', base: 'akan', name: L('雪見温泉') },
    ],
    stay: L('ウトロ'),
  },
  {
    day: 3,
    date: '2027-02-16',
    legs: [],
    stops: [{ id: 'drift-ice-walk', base: 'shiretoko', name: L('流氷ウォーク') }],
    stay: L('ウトロ'),
  },
  {
    day: 4,
    date: '2027-02-17',
    legs: [{ fromId: 'shiretoko', from: L('ウトロ'), to: L('新千歳') }],
    stops: [],
    stay: null,
  },
]

const base: CollisionDescriptor = {
  day: 2,
  leg: 0,
  at: '2027-02-15T16:31:00+09:00',
  alertEnabled: false,
  achievedStops: ['red-crowned-crane'],
}

describe('checkCollision', () => {
  it('UC-6b: 正しい記述子は通る', () => {
    expect(checkCollision(DAYS, base, '2027-02-15')).toEqual([])
  })

  it('UC-6b: day・leg の範囲外、移動の無い日、暦日の違い、読めない時刻は外れる', () => {
    expect(checkCollision(DAYS, { ...base, day: 5 }, '2027-02-15')).toHaveLength(1)
    expect(checkCollision(DAYS, { ...base, day: 0 }, '2027-02-15')).toHaveLength(1)
    expect(checkCollision(DAYS, { ...base, leg: 2 }, '2027-02-15')).not.toEqual([])
    expect(checkCollision(DAYS, { ...base, leg: -1 }, '2027-02-15')).not.toEqual([])
    expect(
      checkCollision(DAYS, { ...base, day: 3, leg: 0, achievedStops: [] }, '2027-02-16'),
    ).not.toEqual([])
    expect(checkCollision(DAYS, base, '2027-02-16')).not.toEqual([])
    expect(checkCollision(DAYS, base, null)).not.toEqual([])
  })

  it('UC-6b: その日に無い楽しみ・重複・衝突した移動より先の町の楽しみは外れる', () => {
    expect(
      checkCollision(DAYS, { ...base, achievedStops: ['drift-ice-walk'] }, '2027-02-15'),
    ).not.toEqual([])
    expect(
      checkCollision(
        DAYS,
        { ...base, achievedStops: ['red-crowned-crane', 'red-crowned-crane'] },
        '2027-02-15',
      ),
    ).not.toEqual([])
    // leg 0（鶴居 → 阿寒）で衝突したなら、阿寒の温泉はまだ
    expect(
      checkCollision(DAYS, { ...base, achievedStops: ['akan-onsen-snow'] }, '2027-02-15'),
    ).toEqual(['achievedStops: 衝突した移動より先の町の楽しみ'])
    // leg 1（阿寒 → ウトロ）なら済ませられる
    expect(
      checkCollision(
        DAYS,
        { ...base, leg: 1, achievedStops: ['red-crowned-crane', 'akan-onsen-snow'] },
        '2027-02-15',
      ),
    ).toEqual([])
  })
})

describe('buildLossBrief', () => {
  it('UC-5a: 達成・失った楽しみ・失った宿の町が分かれ、材料は名前と選択肢由来の値だけ', () => {
    const brief = buildLossBrief({ lang: 'zh', partySize: 4, days: DAYS, collision: base })
    expect(brief.achieved.map((n) => n.ja)).toEqual(['タンチョウ'])
    expect(brief.lost.map((n) => n.ja)).toEqual(['雪見温泉', '流氷ウォーク'])
    // D2・D3 の宿はどちらもウトロ（重複なし）、最終日は宿なし
    expect(brief.lostStays.map((n) => n.ja)).toEqual(['ウトロ'])
    expect(brief).toMatchObject({
      lang: 'zh',
      partySize: 4,
      totalDays: 4,
      collisionDay: 2,
      lostDays: 3,
      alertEnabled: false,
    })
    expect(brief.collisionLeg.from.ja).toBe('鶴居')
    expect(brief.collisionLeg.to.ja).toBe('阿寒')
    // 時刻・道路番号・統計の数字は材料に無い
    const text = JSON.stringify(brief)
    expect(text).not.toContain('16:31')
    expect(text).not.toMatch(/[0-9]{3,}/)
  })

  it('UC-5a: D1 の最初の移動で衝突 → 達成なし、すべて失う', () => {
    const brief = buildLossBrief({
      lang: 'ja',
      partySize: 2,
      days: DAYS,
      collision: { ...base, day: 1, leg: 0, achievedStops: [] },
    })
    expect(brief.achieved).toEqual([])
    expect(brief.lost).toHaveLength(3)
    expect(brief.lostDays).toBe(4)
  })
})

describe('lossKeyMaterial', () => {
  it('IDEM-1: achievedStops の順が違っても同じ鍵', () => {
    const a = { ...base, leg: 1, achievedStops: ['red-crowned-crane', 'akan-onsen-snow'] }
    const b = { ...a, achievedStops: ['akan-onsen-snow', 'red-crowned-crane'] }
    expect(lossKeyMaterial('AbCd1234', a)).toBe(lossKeyMaterial('AbCd1234', b))
  })

  it('IDEM-2: at だけが違えば同じ鍵、leg・alertEnabled・achievedStops・旅が違えば別の鍵', () => {
    const k = lossKeyMaterial('AbCd1234', base)
    expect(lossKeyMaterial('AbCd1234', { ...base, at: '2027-02-15T16:32:09+09:00' })).toBe(k)
    expect(lossKeyMaterial('AbCd1234', { ...base, leg: 1 })).not.toBe(k)
    expect(lossKeyMaterial('AbCd1234', { ...base, alertEnabled: true })).not.toBe(k)
    expect(lossKeyMaterial('AbCd1234', { ...base, achievedStops: [] })).not.toBe(k)
    expect(lossKeyMaterial('XyZw9876', base)).not.toBe(k)
  })
})
