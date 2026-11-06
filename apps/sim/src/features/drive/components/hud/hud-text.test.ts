import { LANGS } from '@antler/i18n-check'
import { describe, expect, it } from 'vitest'
import { NAV_TEXT, navText } from '../../scene/dashboard-text'
import { SEASON_TEXT } from '../season-text'
import { fillHud, hudText, SURFACE_TEXT, WEATHER_TEXT } from './hud-text'

// HUD・出発の案内・ダッシュボードの文言の 4 言語（docs/specs/i18n/functional.md R5）。
// 文字種・欠けは i18n-tables.test.ts が全部の表で見る。ここは「言語ごとに別の表が返る」ことを見る。

const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u

describe('HUD の 4 言語（i18n R5）', () => {
  it('HUD-1: hudText(lang) は言語ごとの表を返し、zh・ko・en に仮名が無い', () => {
    const texts = LANGS.map((lang) => hudText(lang).zone.nextZone)
    expect(new Set(texts).size).toBe(4)
    for (const lang of ['en', 'zh', 'ko'] as const) {
      expect(JSON.stringify(hudText(lang))).not.toMatch(KANA)
    }
    expect(fillHud(hudText('en').stage.cleared, { n: 2, of: 3 })).toBe('Stage 2 / 3 cleared')
  })

  it('HUD-4: 季節の切り替え・天候・路面の文が 4 言語で別々', () => {
    for (const table of [SEASON_TEXT, WEATHER_TEXT, SURFACE_TEXT]) {
      expect(Object.keys(table).sort()).toEqual([...LANGS].sort())
      const rendered = LANGS.map((lang) => JSON.stringify(table[lang]))
      expect(new Set(rendered).size).toBe(4)
    }
    expect(SEASON_TEXT.zh.label).toBe('季節')
    expect(WEATHER_TEXT.ko.rain).not.toMatch(KANA)
  })

  it('HUD-5: navText(nav, lang) が 4 言語で km を差し込み、既定は ja', () => {
    const nav = { kind: 'zone-ahead', km: 2.43 } as const
    expect(navText(nav)).toBe('2.4 km 先 鹿ゾーン')
    expect(navText(nav, 'en')).toBe('Deer zone in 2.4 km')
    expect(navText({ kind: 'destination', km: 12.6 }, 'ko')).toBe('목적지까지 13 km')
    for (const lang of LANGS) {
      for (const text of Object.values(NAV_TEXT[lang])) expect(text).toContain('{km}')
    }
  })
})
