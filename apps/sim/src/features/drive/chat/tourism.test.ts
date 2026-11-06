import { PLEASURES, placeById } from '@antler/trip'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { demoScenario } from '../domain/scenario'
import { ZONES } from '../domain/zones-data'
import { advanceChat, initialChatState, type ChatFrame } from './advance-chat'
import { FALLBACK_PLEASURE_TEXT, RADIO_FALLBACK_TEXT, RADIO_PLEASURE_TEXT } from './chat-text'
import { buildChatTrack } from './chat-track'
import type { ChatDeck } from './chat-types'
import { fallbackChatDeck } from './fallback-deck'
import { hasDeerWord, nearbyPleasures, todayPleasures, tourismPleasures } from './tourism'

// 運転中の観光の話題（docs/specs/drive-tourism/functional.md T7・T9・T14、UC-3b・UC-3d・UC-3e）

const L = (ja: string) => ({ ja, en: ja, zh: ja, ko: ja })
const DEMO = demoScenario(ZONES)
const DIGIT = /[0-9０-９]/

const frame = (over: Partial<ChatFrame>): ChatFrame => ({
  t: 0,
  positionKm: 0,
  zoneInterval: null,
  alert: 'safe',
  alertEnabled: true,
  paused: false,
  outcome: 'driving',
  avoidedCount: 0,
  stage: 1,
  ...over,
})

describe('UC-3b: 楽しみの id を道のりと画面の行まで運ぶ', () => {
  it('UC-3b: 道のりに写した行と、出す行が pleasure を持つ（反応の行は null）', () => {
    const deck: ChatDeck = {
      tripId: 't1',
      day: 1,
      lines: [
        {
          id: 'l01',
          cue: { kind: 'road', leg: 0, km: 1 },
          topic: 'pleasure',
          speaker: 'p1',
          pleasure: 'akan-onsen-snow',
          text: L('温泉'),
        },
        {
          id: 'l02',
          cue: { kind: 'road', leg: 0, km: 2 },
          topic: 'snack',
          speaker: 'p2',
          pleasure: null,
          text: L('おやつ'),
        },
      ],
      data: null,
    }
    const track = buildChatTrack(deck, {
      legStartsM: [0],
      totalM: 10_000,
      partySize: 3,
      seed: 1,
    })
    expect(track.road.map((r) => r.pleasure)).toEqual(['akan-onsen-snow', null])
    const first = advanceChat(initialChatState(), track, frame({ t: 1000, positionKm: 1.5 }))
    expect(first.emitted.map((e) => e.pleasure)).toEqual(['akan-onsen-snow'])
    const second = advanceChat(first.state, track, frame({ t: 2000, positionKm: 2.5 }))
    expect(second.emitted.map((e) => e.pleasure)).toEqual([null])
    // ゾーンに入った反応（2.5 秒後）は楽しみの話ではない
    const entered = advanceChat(
      second.state,
      track,
      frame({ t: 3000, positionKm: 3, zoneInterval: 0, alert: 'zone' }),
    )
    const reaction = advanceChat(
      entered.state,
      track,
      frame({ t: 5600, positionKm: 3.1, zoneInterval: 0, alert: 'zone' }),
    )
    expect(reaction.emitted.length).toBeGreaterThan(0)
    expect(reaction.emitted.every((e) => e.pleasure === null)).toBe(true)
  })
})

describe('UC-3d: 見本の会話の楽しみ（T9）', () => {
  const base = {
    tripId: 'demo',
    day: 1,
    legStartsM: [0],
    totalM: 130_000,
    zonesKm: [] as [number, number][],
    seed: 3,
  }

  it('UC-3d: 見本の場面（2 月・阿寒湖に着く・立ち寄りなし）は旅の月に合う到着地の楽しみ', () => {
    expect(todayPleasures(DEMO)).toEqual([])
    const ids = tourismPleasures(DEMO).map((p) => p.id)
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      const p = PLEASURES.find((x) => x.id === id)
      expect(p?.base).toBe('akan')
      expect(p?.months.length === 0 || p?.months.includes(2)).toBe(true)
    }
  })

  it('UC-3d: 到着地の楽しみは旅の月で絞り、その日の楽しみを除く。その日の楽しみがあればそちら', () => {
    const summer = { stops: [], to: 'akan', startAt: '2027-07-10T09:00+09:00' }
    // 阿寒湖の雪の温泉（12〜3 月）は 7 月には出さない
    expect(nearbyPleasures(summer).map((p) => p.id)).not.toContain('akan-onsen-snow')
    expect(nearbyPleasures(summer).map((p) => p.id)).toContain('akan-ainu-kotan')
    const withStop = { stops: ['akan-ainu-kotan'], to: 'akan', startAt: '2027-02-10T09:00+09:00' }
    expect(nearbyPleasures(withStop).map((p) => p.id)).not.toContain('akan-ainu-kotan')
    expect(tourismPleasures(withStop).map((p) => p.id)).toEqual(['akan-ainu-kotan'])
    // マスターに無い id は飛ばす
    expect(todayPleasures({ stops: ['no-such', 'akan-ainu-kotan'] }).map((p) => p.id)).toEqual([
      'akan-ainu-kotan',
    ])
  })

  it('UC-3d: 話の行の i mod 3 が 0・1 は楽しみの話（id つき）、2 はほかの話題（pleasure は null）', () => {
    const pleasures = tourismPleasures(DEMO).map((p) => ({ id: p.id, name: p.name }))
    const deck = fallbackChatDeck({ ...base, partySize: 3, pleasures })
    const talk = deck.lines.filter((l) => l.topic !== 'depart')
    expect(talk.length).toBeGreaterThanOrEqual(6)
    talk.forEach((l, i) => {
      if (i % 3 === 2) {
        expect(l.topic).not.toBe('pleasure')
        expect(l.pleasure).toBeNull()
      } else {
        expect(l.topic).toBe('pleasure')
        expect(pleasures.map((p) => p.id)).toContain(l.pleasure)
      }
    })
    // 楽しみは順に回す
    const used = talk.flatMap((l) => (l.pleasure ? [l.pleasure] : []))
    expect(new Set(used).size).toBe(Math.min(pleasures.length, used.length))
    expect(deck.lines.find((l) => l.topic === 'depart')?.pleasure).toBeNull()
  })

  it('UC-3d: 楽しみが無ければ楽しみの話をしない（1 人旅はラジオの文を順に）', () => {
    const none = fallbackChatDeck({ ...base, partySize: 3, pleasures: [] })
    expect(none.lines.every((l) => l.pleasure === null && l.topic !== 'pleasure')).toBe(true)
    const solo = fallbackChatDeck({ ...base, totalM: 70_000, partySize: 1 })
    expect(solo.lines.map((l) => l.text)).toEqual(RADIO_FALLBACK_TEXT.slice(0, solo.lines.length))
  })

  it('UC-3d: 1 人旅の楽しみの行はラジオの言い方', () => {
    const pleasures = tourismPleasures(DEMO).map((p) => ({ id: p.id, name: p.name }))
    const solo = fallbackChatDeck({ ...base, partySize: 1, pleasures })
    const first = solo.lines.find((l) => l.topic === 'pleasure')
    const p = pleasures.find((x) => x.id === first?.pleasure)
    expect(p).toBeDefined()
    if (p) expect(first?.text).toEqual(RADIO_PLEASURE_TEXT[0]?.(p.name))
    expect(solo.lines.every((l) => l.speaker === 'radio')).toBe(true)
  })

  it('UC-3d: 全部の楽しみの名前を差し込んだ 4 言語の文と、楽しみの名前・拠点の地名に数字・鹿の語・絵文字が無い', () => {
    for (const p of PLEASURES) {
      const place = placeById(p.base)
      for (const value of [...Object.values(p.name), ...Object.values(place?.name ?? {})]) {
        expect(value).not.toMatch(DIGIT)
        expect(hasDeerWord(value)).toBe(false)
      }
      for (const make of [...FALLBACK_PLEASURE_TEXT, ...RADIO_PLEASURE_TEXT]) {
        const text = make(p.name)
        expect(Object.keys(text).sort()).toEqual(['en', 'ja', 'ko', 'zh'])
        for (const [lang, value] of Object.entries(text)) {
          expect(value).toContain(p.name[lang as keyof typeof p.name])
          expect(value).not.toMatch(DIGIT)
          expect(value).not.toMatch(/\p{Extended_Pictographic}/u)
          expect(hasDeerWord(value)).toBe(false)
        }
      }
    }
  })

  it('UC-3d: 鹿の語は全角・大文字でも見つける', () => {
    expect(hasDeerWord('ＤＥＥＲ crossing')).toBe(true)
    expect(hasDeerWord('エゾシカ')).toBe(true)
    expect(hasDeerWord('사슴')).toBe(true)
    expect(hasDeerWord('温泉')).toBe(false)
  })
})

describe('UC-3e: 右の列の並び（T14。CSS の決まり）', () => {
  const css = readFileSync(resolve(__dirname, 'chat-feed.css'), 'utf8')
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`)
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at))
  }

  it('UC-3e: 会話は右上から積み（列は flex-start）、おすすめと音量の操作は下に寄せる', () => {
    expect(rule('.drive-chat-column')).toMatch(/justify-content:\s*flex-start/)
    expect(rule('.drive-chat-column .drive-recommend')).toMatch(/margin-top:\s*auto/)
    expect(rule('.drive-chat-column .drive-chat + .drive-audio')).toMatch(/margin-top:\s*auto/)
    // 高さが足りなければ会話だけが縮む
    expect(rule('.drive-chat-column .drive-recommend')).toMatch(/flex:\s*none/)
    expect(rule('.drive-chat')).toMatch(/overflow:\s*hidden/)
  })
})
