import type { ChatPlan } from '../models/chat-deck.js'
import type { ChatMaterial, ChatMaterialLeg, LightOnRoad } from '../models/chat-material.js'
import { buildChatPlan, chatKeyMaterial } from './chat-plan-policy.js'

// 会話の束の組み立て（docs/specs/drive-audio-chat/functional.md R10・R11、Test List PLAN-1a〜1g）。
// 手作りの材料で各枝を通す（ペルソナの旅は usecase と e2e のテストで通す）。

const HOUR = 3_600_000
const T0 = Date.parse('2027-02-14T09:00:00+09:00')

function leg(distanceKm: number, i = 0, over: Partial<ChatMaterialLeg> = {}): ChatMaterialLeg {
  return {
    from: `p${String(i)}`,
    to: `p${String(i + 1)}`,
    departMs: T0 + i * 3 * HOUR,
    arriveMs: T0 + i * 3 * HOUR + 2 * HOUR,
    distanceKm,
    ...over,
  }
}

function material(over: Partial<ChatMaterial> = {}): ChatMaterial {
  return {
    tripId: 'K7m2abcd',
    seed: 918273,
    day: 1,
    partySize: 4,
    legs: [leg(100)],
    zones: [],
    stops: [],
    data: { routes: '2026-11-03', zones: 'hash' },
    ...over,
  }
}

const lightAt: LightOnRoad = () => 'dusk'
const plan = (over: Partial<ChatMaterial> = {}, light: LightOnRoad = lightAt): ChatPlan =>
  buildChatPlan(material(over), light)
const talks = (p: ChatPlan) => p.lines.filter((l) => l.topic !== 'depart')
const departs = (p: ChatPlan) => p.lines.filter((l) => l.topic === 'depart')
const SEEDS = Array.from({ length: 40 }, (_, i) => 1000 + i * 7919)

describe('buildChatPlan', () => {
  it('PLAN-1a: 各移動の 0.2 km に depart、話の行は min(3, floor(距離 ÷ 15)) 行、[1 km, 距離 − 1 km] の中', () => {
    for (const seed of SEEDS) {
      const p = plan({ seed, legs: [leg(100, 0), leg(30, 1), leg(14.9, 2), leg(0.8, 3)] })
      expect(departs(p).map((l) => [l.cue.leg, l.cue.km])).toEqual([
        [0, 0.2],
        [1, 0.2],
        [2, 0.2],
        [3, 0.2],
      ])
      const perLeg = [0, 1, 2, 3].map((i) => talks(p).filter((l) => l.cue.leg === i))
      expect(perLeg.map((ls) => ls.length)).toEqual([3, 2, 0, 0])
      for (const l of perLeg[0] ?? []) {
        expect(l.cue.km).toBeGreaterThanOrEqual(1)
        expect(l.cue.km).toBeLessThanOrEqual(99)
      }
      // 候補は k + 1 等分した点の ±10%（移動の距離に対して）
      const expected = [25, 50, 75]
      perLeg[0]?.forEach((l, j) => {
        expect(Math.abs(l.cue.km - (expected[j] ?? 0))).toBeLessThanOrEqual(10.05)
      })
      // km は 0.1 km に丸める
      for (const l of p.lines) expect(Math.round(l.cue.km * 10) / 10).toBe(l.cue.km)
    }
  })

  it('PLAN-1a: 0.8 km の移動は depart だけ。0.2 km より短い移動は終わりに置く', () => {
    expect(plan({ legs: [leg(0.8)] }).lines.map((l) => [l.topic, l.cue.km])).toEqual([
      ['depart', 0.2],
    ])
    expect(plan({ legs: [leg(0.1)] }).lines.map((l) => l.cue.km)).toEqual([0.1])
  })

  it('PLAN-1b: ゾーンの中の候補は入口の 1 km 手前へ。別のゾーンならさらに手前へ繰り返す', () => {
    // 29 km の移動（候補 1 つ）: 候補は 14.5 ± 2.9 km → [10, 20] の中 → 9 km → [7, 9.5] の中 → 6 km
    for (const seed of SEEDS) {
      const p = plan({
        seed,
        legs: [leg(29)],
        zones: [
          { leg: 0, entryKm: 10, exitKm: 20 },
          { leg: 0, entryKm: 7, exitKm: 9.5 },
        ],
      })
      expect(talks(p).map((l) => l.cue.km)).toEqual([6])
    }
  })

  it('PLAN-1b: 入口が 1.5 km のゾーン → 候補は作らない。depart と 1 km 以内になった候補も作らない', () => {
    for (const seed of SEEDS) {
      const early = plan({ seed, legs: [leg(45)], zones: [{ leg: 0, entryKm: 1.5, exitKm: 44.5 }] })
      expect(talks(early)).toHaveLength(0)
      // 29 km: 候補は [2, 20] の中 → 入口の 1 km 手前の 1.0 km。depart（0.2）と 0.8 km → 作らない
      const near = plan({ seed, legs: [leg(29)], zones: [{ leg: 0, entryKm: 2, exitKm: 20 }] })
      expect(talks(near)).toHaveLength(0)
      // 同じ地点に動いた 2 つ目の候補も作らない（40 km: 候補 2 つが [5, 35] の中 → どちらも 4 km）
      const same = plan({ seed, legs: [leg(40)], zones: [{ leg: 0, entryKm: 5, exitKm: 35 }] })
      expect(talks(same).map((l) => l.cue.km)).toEqual([4])
    }
  })

  it('PLAN-1b: どの行もゾーンの外。同じ移動の行どうしは 1 km より離れる', () => {
    for (const seed of SEEDS) {
      const zones = [
        { leg: 0, entryKm: 20, exitKm: 26 },
        { leg: 0, entryKm: 48, exitKm: 55 },
        { leg: 1, entryKm: 0, exitKm: 3 },
      ]
      const p = plan({ seed, legs: [leg(90, 0), leg(60, 1)], zones })
      for (const l of p.lines) {
        const inside = zones.some(
          (z) => z.leg === l.cue.leg && z.entryKm <= l.cue.km && l.cue.km <= z.exitKm,
        )
        expect(inside).toBe(false)
      }
      for (const i of [0, 1]) {
        const kms = p.lines.filter((l) => l.cue.leg === i).map((l) => l.cue.km)
        for (let j = 1; j < kms.length; j++) {
          expect((kms[j] ?? 0) - (kms[j - 1] ?? 0)).toBeGreaterThan(1)
        }
      }
    }
  })

  it('PLAN-1c: 話の行は 1 日 10 行まで（後ろの移動から減らす）。depart は数えない', () => {
    const legs = [0, 1, 2, 3, 4].map((i) => leg(60, i))
    const p = plan({ legs })
    expect(talks(p)).toHaveLength(10)
    expect([0, 1, 2, 3, 4].map((i) => talks(p).filter((l) => l.cue.leg === i).length)).toEqual([
      3, 3, 3, 1, 0,
    ])
    expect(departs(p)).toHaveLength(5)
  })

  it('PLAN-1d: 話題は続かない。楽しみが残っていない日は pleasure を選ばない。light には通過時刻の光', () => {
    const seen = new Set<string>()
    for (const seed of SEEDS) {
      const legs = [leg(60, 0), leg(60, 1), leg(60, 2)]
      const done = plan({ seed, legs, stops: [{ id: 'crane', base: 'p0' }] })
      expect(done.lines.some((l) => l.topic === 'pleasure')).toBe(false)
      const none = plan({ seed, legs })
      expect(none.lines.some((l) => l.topic === 'pleasure')).toBe(false)

      const ahead = plan({ seed, legs, stops: [{ id: 'drift-ice', base: 'p2' }] })
      const ts = talks(ahead)
      for (let i = 1; i < ts.length; i++) expect(ts[i]?.topic).not.toBe(ts[i - 1]?.topic)
      for (const l of ahead.lines) {
        seen.add(l.topic)
        if (l.topic === 'pleasure') {
          expect(l.pleasure).toBe('drift-ice')
          // 楽しみの拠点（p2）に着く移動（leg 1）より後には、その楽しみは残っていない
          expect(l.cue.leg).toBeLessThanOrEqual(1)
        } else expect(l.pleasure).toBeNull()
        expect(l.light).toBe(l.topic === 'light' ? 'dusk' : null)
      }
    }
    expect([...seen].sort()).toEqual(
      ['depart', 'light', 'music', 'pleasure', 'scenery', 'snack', 'weather'].sort(),
    )
  })

  it('PLAN-1d: light の光は、その地点をしおりどおりに通る時刻で測る', () => {
    const calls: [number, number, number][] = []
    const spy: LightOnRoad = (l, km, atMs) => {
      calls.push([l, km, atMs])
      return 'night'
    }
    for (const seed of SEEDS) {
      calls.length = 0
      const p = plan({ seed, legs: [leg(100)] }, spy)
      const light = p.lines.find((l) => l.topic === 'light')
      if (!light) continue
      const call = calls.find(([, km]) => km === light.cue.km)
      expect(call?.[2]).toBe(T0 + Math.floor((light.cue.km / 100) * 2 * HOUR))
      expect(light.light).toBe('night')
      return
    }
    throw new Error('light の行が出るシードが無い')
  })

  it('PLAN-1e: 話し手は人数 − 1 人（最大 3）、1 人旅は radio。2 人以上なら同じ人が続かない', () => {
    const legs = [leg(100, 0), leg(100, 1)]
    for (const seed of SEEDS) {
      expect(new Set(plan({ seed, legs, partySize: 1 }).lines.map((l) => l.speaker))).toEqual(
        new Set(['radio']),
      )
      expect(new Set(plan({ seed, legs, partySize: 2 }).lines.map((l) => l.speaker))).toEqual(
        new Set(['p1']),
      )
      for (const size of [3, 4, 6]) {
        const lines = plan({ seed, legs, partySize: size }).lines
        const allowed = ['p1', 'p2', 'p3'].slice(0, Math.min(3, size - 1))
        for (const l of lines) expect(allowed).toContain(l.speaker)
        for (let i = 1; i < lines.length; i++) {
          expect(lines[i]?.speaker).not.toBe(lines[i - 1]?.speaker)
        }
      }
    }
  })

  it('PLAN-1f: 移動の無い日は空の束。depart の 0.2 km がゾーンの中なら出口の 0.2 km 先', () => {
    expect(plan({ legs: [] }).lines).toEqual([])
    const moved = plan({ legs: [leg(50)], zones: [{ leg: 0, entryKm: 0, exitKm: 5 }] })
    expect(departs(moved).map((l) => l.cue.km)).toEqual([5.2])
    // 出口の先がさらに別のゾーンなら、その出口の先へ
    const chained = plan({
      legs: [leg(50)],
      zones: [
        { leg: 0, entryKm: 0, exitKm: 5 },
        { leg: 0, entryKm: 5.1, exitKm: 8 },
      ],
    })
    expect(departs(chained).map((l) => l.cue.km)).toEqual([8.2])
  })

  it('PLAN-1f: 出口が移動の終わりの 1 km 手前より先なら depart を作らない', () => {
    const p = plan({ legs: [leg(50)], zones: [{ leg: 0, entryKm: 0, exitKm: 49.5 }] })
    expect(departs(p)).toHaveLength(0)
  })

  it('PLAN-1g: 同じ旅・同じ日 → 同じ束。別の seed・別の日 → どこかが変わる。id は l01 から順', () => {
    const legs = [leg(100, 0), leg(60, 1)]
    const a = plan({ legs })
    expect(plan({ legs })).toEqual(a)
    expect(a.lines.map((l) => l.id)).toEqual(
      a.lines.map((_, i) => `l${String(i + 1).padStart(2, '0')}`),
    )
    // 並び: 移動の順 → km の順
    const order = a.lines.map((l) => l.cue.leg * 1000 + l.cue.km)
    expect([...order].sort((x, y) => x - y)).toEqual(order)
    const shape = (p: ChatPlan) => JSON.stringify(p.lines.map((l) => [l.cue, l.topic, l.speaker]))
    expect(shape(plan({ legs, seed: 42 }))).not.toBe(shape(a))
    expect(shape(plan({ legs, day: 2 }))).not.toBe(shape(a))
    expect(a).toMatchObject({ tripId: 'K7m2abcd', day: 1, data: { routes: '2026-11-03' } })
  })

  it('PLAN-1g: 保存の鍵の材料は chat:v1|旅|日|routes|zones', () => {
    expect(chatKeyMaterial('K7m2abcd', 2, { routes: 'r', zones: 'z' })).toBe(
      'chat:v1|K7m2abcd|2|r|z',
    )
  })
})
