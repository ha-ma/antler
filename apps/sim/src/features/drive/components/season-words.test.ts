import { describe, expect, it } from 'vitest'
import { detectProbability } from '../domain/detection'
import { WEATHER_TEXT } from './hud/hud-text'

// docs/specs/drive-season/functional.md R5（UC-5a）

describe('天候「雨」の文言と係数（drive-season R5）', () => {
  it('UC-5a: HUD に「雨」があり、検知の確率は曇りより低く雪より高い', () => {
    expect(WEATHER_TEXT.ja.rain).toBe('雨')
    expect(WEATHER_TEXT.en.rain).toBe('Rain')
    const p = (w: Parameters<typeof detectProbability>[1]) => detectProbability('day', w, 'none')
    expect(p('rain')).toBeLessThan(p('cloudy'))
    expect(p('rain')).toBeGreaterThan(p('snow'))
  })
})
