import { stopDeckBody } from '@/test/stop-deck'
import { CHOICE_TEXT, LIGHT_TEXT, SCENE_TEXT, STOP_TEXT } from '../text'
import type { StopDeck } from '../types'
import { hhmm, isAfterDate, lightWord, yen } from './format'
import { parseStopDeckResponse } from './parse-deck'
import { roadScenesBetween, scenesBeforeLeg, writingFor } from './scenes'

// 場面の選び出し・表示の整形・応答の形・文言（docs/specs/stop-events/functional.md UI-4b・UI-4e・UI-4g）。

const body = stopDeckBody()
const deck = body.deck as unknown as StopDeck

describe('場面の選び出し', () => {
  it('UI-4g: scenesBeforeLeg は止まり場所の楽しみ、roadScenesBetween は fromKm < km ≤ toKm のランダム', () => {
    expect(scenesBeforeLeg(deck, 1).map((s) => s.id)).toEqual(['p-red-crowned-crane'])
    expect(scenesBeforeLeg(deck, 0)).toEqual([])
    expect(roadScenesBetween(deck, 1, 10, 12.5).map((s) => s.id)).toEqual(['r1-fuel'])
    expect(roadScenesBetween(deck, 1, 12.5, 20)).toEqual([])
    expect(roadScenesBetween(deck, 0, 0, 100)).toEqual([])
    expect(writingFor(body.writing, 'p-red-crowned-crane')?.id).toBe('p-red-crowned-crane')
    expect(writingFor(body.writing, 'r1-fuel')).toBeNull()
    expect(writingFor(undefined, 'r1-fuel')).toBeNull()
  })
})

describe('表示の整形', () => {
  it('UI-4b: 時刻・翌日・光の言い方・金額', () => {
    expect(hhmm('2027-02-15T16:20+09:00')).toBe('16:20')
    expect(isAfterDate('2027-02-16T00:05+09:00', '2027-02-15')).toBe(true)
    expect(isAfterDate('2027-02-15T23:59+09:00', '2027-02-15')).toBe(false)
    expect(lightWord('night', '2027-02-15T05:00+09:00', '2027-02-15')).toBe('beforeDawn')
    expect(lightWord('night', '2027-02-15T19:00+09:00', '2027-02-15')).toBe('afterSunset')
    expect(lightWord('night', '2027-02-16T01:00+09:00', '2027-02-15')).toBe('afterSunset')
    expect(lightWord('dusk', '2027-02-15T16:20+09:00', '2027-02-15')).toBe('dusk')
    expect(yen(96000)).toBe('¥96,000')
  })

  it('UI-4b: 文言は 4 言語がそろい、空でない', () => {
    const tables = [STOP_TEXT, LIGHT_TEXT, SCENE_TEXT, CHOICE_TEXT] as Record<
      string,
      Record<string, string>
    >[]
    for (const table of tables) {
      for (const [key, value] of Object.entries(table)) {
        for (const lang of ['ja', 'en', 'zh', 'ko']) {
          expect(value[lang], `${key}.${lang}`).toBeTruthy()
        }
      }
    }
  })
})

describe('応答の形', () => {
  it('UI-4e: 正しい応答は通り、欠けた欄・選択肢 1 つ・知らない光は null', () => {
    expect(parseStopDeckResponse(stopDeckBody())?.deck.scenes).toHaveLength(2)
    expect(parseStopDeckResponse(null)).toBeNull()
    const noWriting = { ...stopDeckBody(), writing: null }
    expect(parseStopDeckResponse(noWriting)).toBeNull()
    const one = stopDeckBody()
    one.deck.scenes[1]?.choices.pop()
    expect(parseStopDeckResponse(one)).toBeNull()
    const light = stopDeckBody()
    const zone = light.deck.scenes[0]?.choices[0]?.zone
    if (zone) (zone as { light: string }).light = 'noon'
    expect(parseStopDeckResponse(light)).toBeNull()
  })
})
