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
    laterStops: [],
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

  // drive-tourism T1〜T3（docs/specs/drive-tourism/functional.md UC-1a〜1d）
  it('UC-1a: 話の行の i mod 3 が 0・1 は楽しみ（候補があれば）、2 は楽しみ以外の 5 種から（続けない）。light には通過時刻の光', () => {
    const seen = new Set<string>()
    for (const seed of SEEDS) {
      const legs = [leg(60, 0), leg(60, 1), leg(60, 2)]
      const p = plan({ seed, legs, stops: [{ id: 'drift-ice', base: 'p3' }] })
      const ts = talks(p)
      expect(ts.length).toBeGreaterThanOrEqual(6)
      let previousOther: string | null = null
      ts.forEach((l, i) => {
        seen.add(l.topic)
        if (i % 3 === 2) {
          expect(l.topic).not.toBe('pleasure')
          expect(l.topic).not.toBe(previousOther)
          previousOther = l.topic
        } else expect(l.topic).toBe('pleasure')
        if (l.topic === 'pleasure') {
          expect(l.pleasure).toBe('drift-ice')
          expect(l.timing).toBe('ahead')
        } else {
          expect(l.pleasure).toBeNull()
          expect(l.timing).toBeNull()
          expect(l.angle).toBeNull()
          expect(l.when).toBeNull()
        }
        expect(l.light).toBe(l.topic === 'light' ? 'dusk' : null)
      })
      for (const l of departs(p)) {
        expect([l.pleasure, l.timing, l.angle, l.when]).toEqual([null, null, null, null])
      }
      // 楽しみの行は話の行の 3 分の 2 以上
      expect(ts.filter((l) => l.topic === 'pleasure').length * 3).toBeGreaterThanOrEqual(
        ts.length * 2 - 2,
      )
    }
    expect([...seen].sort()).toEqual(
      ['light', 'music', 'pleasure', 'scenery', 'snack', 'weather'].sort(),
    )
  })

  it('UC-1b: その日のこれからの楽しみを順に回す。済んだ後の移動は、いちばん最近の楽しみ（done）と後の日の楽しみを回す', () => {
    const legs = [leg(60, 0), leg(60, 1), leg(60, 2)]
    for (const seed of SEEDS) {
      const p = plan({
        seed,
        legs,
        stops: [
          { id: 'crane', base: 'p1' },
          { id: 'drift-ice', base: 'p2' },
        ],
        laterStops: [{ id: 'sushi' }],
      })
      const pleasures = talks(p).filter((l) => l.topic === 'pleasure')
      for (const l of pleasures) {
        if (l.cue.leg === 0) {
          // leg 0 を走る間は crane（p1）も drift-ice（p2）もこれから
          expect(['crane', 'drift-ice']).toContain(l.pleasure)
          expect(l.timing).toBe('ahead')
        } else if (l.cue.leg === 1) {
          expect(l.pleasure).toBe('drift-ice')
          expect(l.timing).toBe('ahead')
        } else {
          // 済んだ後: いちばん最近の drift-ice の振り返りと、後の日の sushi
          expect(['drift-ice', 'sushi']).toContain(l.pleasure)
          expect(l.timing).toBe(l.pleasure === 'drift-ice' ? 'done' : 'ahead')
          expect(l.when).toBe(l.pleasure === 'drift-ice' ? 'today' : 'later')
          if (l.timing === 'done') expect(l.angle).toBe('memory')
        }
      }
      expect(pleasures.length).toBeGreaterThan(0)
      // leg 0 の楽しみの行が 2 つ以上なら、2 件を交互に回す
      const first = pleasures.filter((l) => l.cue.leg === 0).map((l) => l.pleasure)
      if (first.length >= 2) expect(first[0]).not.toBe(first[1])
    }
  })

  it('UC-1b: 移動ごとに候補が変わっても、話した回数の少ない楽しみから選ぶ（飛ばされる楽しみを作らない。code-reviewer W3）', () => {
    // leg 0 の候補は a・b・c、leg 1 は b・c、leg 2 は c。どの楽しみも少なくとも 1 回は話す
    const legs = [leg(30, 0), leg(30, 1), leg(30, 2)]
    for (const seed of SEEDS) {
      const p = plan({
        seed,
        legs,
        stops: [
          { id: 'a', base: 'p1' },
          { id: 'b', base: 'p2' },
          { id: 'c', base: 'p3' },
        ],
      })
      const used = talks(p)
        .filter((l) => l.topic === 'pleasure')
        .map((l) => l.pleasure)
      if (used.length >= 3) expect(new Set(used)).toEqual(new Set(['a', 'b', 'c']))
      // 同じ回数なら候補の順（しおりの順）
      expect(used[0]).toBe('a')
    }
  })

  it('UC-1c: その日に楽しみが無ければ後の日の楽しみ（最大 3 件）。旅に楽しみが無ければ楽しみの行なし', () => {
    const legs = [leg(100, 0), leg(100, 1), leg(100, 2)]
    for (const seed of SEEDS) {
      const later = plan({
        seed,
        legs,
        laterStops: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
      })
      const ids = talks(later)
        .filter((l) => l.topic === 'pleasure')
        .map((l) => l.pleasure)
      expect(ids.length).toBeGreaterThan(0)
      for (const id of ids) expect(['a', 'b', 'c']).toContain(id)
      for (const l of talks(later)) {
        if (l.topic !== 'pleasure') continue
        expect(l.timing).toBe('ahead')
        // 後の日の楽しみは「今日」と区別する（M5）
        expect(l.when).toBe('later')
      }

      const none = plan({ seed, legs })
      expect(none.lines.some((l) => l.topic === 'pleasure')).toBe(false)
      const ts = talks(none)
      for (let i = 1; i < ts.length; i++) expect(ts[i]?.topic).not.toBe(ts[i - 1]?.topic)
    }
  })

  it('UC-1f: 拠点がどの移動の両端にも無い楽しみは、その日の最後まで ahead（done の振り返りにしない）', () => {
    for (const seed of SEEDS) {
      const p = plan({
        seed,
        legs: [leg(60, 0), leg(60, 1)],
        stops: [{ id: 'far', base: 'nowhere' }],
      })
      const pleasures = talks(p).filter((l) => l.topic === 'pleasure')
      expect(pleasures.length).toBeGreaterThan(0)
      for (const l of pleasures) {
        expect(l.pleasure).toBe('far')
        expect(l.timing).toBe('ahead')
        expect(l.when).toBe('today')
      }
    }
  })

  it('UC-1d: 同じ楽しみの ahead の切り口は anticipation → highlight → tip → anticipation', () => {
    const p = plan({
      legs: [leg(100, 0), leg(100, 1), leg(100, 2), leg(100, 3)],
      stops: [{ id: 'onsen', base: 'p4' }],
    })
    const angles = talks(p)
      .filter((l) => l.topic === 'pleasure')
      .map((l) => l.angle)
    expect(angles.length).toBeGreaterThanOrEqual(4)
    expect(angles.slice(0, 4)).toEqual(['anticipation', 'highlight', 'tip', 'anticipation'])
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

  it('PLAN-1g・UC-1e・FAIL-61: 保存の鍵の材料は chat:v2|旅|日|routes|zones（v1 の束は読まれない）', () => {
    expect(chatKeyMaterial('K7m2abcd', 2, { routes: 'r', zones: 'z' })).toBe(
      'chat:v2|K7m2abcd|2|r|z',
    )
  })
})
