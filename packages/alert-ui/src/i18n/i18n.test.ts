import { describe, expect, it } from 'vitest'
import { ALERT_TEXT, otherLangs, resolveLang } from './i18n'

describe('UC-6 言語', () => {
  it('UC-6a: ja の danger は主文「前方に鹿」、副文は「DEER AHEAD ・ 前方有鹿 ・ 전방 사슴」', () => {
    expect(ALERT_TEXT.ja.danger.headline).toBe('前方に鹿')
    expect(
      otherLangs('ja')
        .map((l) => ALERT_TEXT[l].danger.headline)
        .join(' ・ '),
    ).toBe('DEER AHEAD ・ 前方有鹿 ・ 전방 사슴')
  })

  it('UC-6b: 4 言語すべてに 3 状態の主文があり、副文は残り 3 言語', () => {
    for (const lang of ['ja', 'en', 'zh', 'ko'] as const) {
      expect(otherLangs(lang)).toHaveLength(3)
      expect(otherLangs(lang)).not.toContain(lang)
      for (const state of ['safe', 'zone', 'danger'] as const) {
        expect(ALERT_TEXT[lang][state].headline.length).toBeGreaterThan(0)
      }
    }
    expect(ALERT_TEXT.ja.safe.headline).toBe('鹿ゾーンまで')
    expect(ALERT_TEXT.ja.zone.headline).toBe('鹿ゾーン走行中')
    expect(ALERT_TEXT.ja.zone.action).toBe('減速 50 km/h 以下に')
    expect(ALERT_TEXT.ja.danger.action).toBe('ブレーキ')
    expect(ALERT_TEXT.zh.zone.headline).toBe('鹿區行駛中')
    expect(ALERT_TEXT.ko.safe.headline).toBe('사슴 구역까지')
  })

  it('UC-6c: resolveLang は端末の言語の一覧から ja / zh / ko を選び、それ以外は en', () => {
    expect(resolveLang(['ja-JP'])).toBe('ja')
    expect(resolveLang(['zh-TW'])).toBe('zh')
    expect(resolveLang(['zh-Hant-TW'])).toBe('zh')
    expect(resolveLang(['zh-HK'])).toBe('zh')
    expect(resolveLang(['ko-KR'])).toBe('ko')
    expect(resolveLang(['zh-CN'])).toBe('en')
    expect(resolveLang(['zh-Hans'])).toBe('en')
    expect(resolveLang(['fr-FR', 'ja'])).toBe('ja')
    expect(resolveLang(['fr'])).toBe('en')
    expect(resolveLang([])).toBe('en')
  })
})
