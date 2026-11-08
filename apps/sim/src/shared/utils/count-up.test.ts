import { formatBudget } from '@antler/trip'
import { countUpFrame, easeOutCubic, hasNumber } from './count-up'

// 数え上げの 1 コマ（docs/specs/result-countup/functional.md R2、FRAME-1〜FRAME-3）

const LANGS = ['ja', 'en', 'zh', 'ko'] as const

describe('countUpFrame', () => {
  it('FRAME-1: 進み 1 のコマは元の文字列と同じ', () => {
    const texts = [
      ...LANGS.map((lang) => formatBudget(615000, lang)),
      ...LANGS.map((lang) => formatBudget(1234567, lang)),
      '1 / 2',
      '1.2',
      '6,705',
      '—',
      '−¥5,000',
      '-12.50',
    ]
    for (const text of texts) {
      expect(countUpFrame(text, 1)).toBe(text)
      expect(countUpFrame(text, 1, [0, 1])).toBe(text)
    }
  })

  it('FRAME-2: 進み 0 のコマは数字を 0 にし、数字でない部分と小数の桁数を残す。hold の数字は最後の値のまま', () => {
    expect(countUpFrame('¥615,000（約 $4,100）', 0)).toBe('¥0（約 $0）')
    expect(countUpFrame('¥615,000 (about $4,100)', 0)).toBe('¥0 (about $0)')
    expect(countUpFrame('1.2', 0)).toBe('0.0')
    expect(countUpFrame('1 / 2', 0, [1])).toBe('0 / 2')
    expect(countUpFrame('3 / 5', 0)).toBe('0 / 0')
    expect(countUpFrame('—', 0)).toBe('—')
  })

  it('FRAME-3: 途中のコマは同じ 3 桁区切り・小数の桁数で、ease-out で進む（整数は四捨五入）', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(0.5)).toBe(0.875)
    expect(easeOutCubic(1)).toBe(1)
    // 0.5 の進み → 615,000 × 0.5 = 307,500（区切りあり）、4,100 × 0.5 = 2,050
    expect(countUpFrame('¥615,000（約 $4,100）', 0.5)).toBe('¥307,500（約 $2,050）')
    // 区切りの無い数字は区切らない
    expect(countUpFrame('12345 件', 0.5)).toBe('6173 件')
    // 小数 1 桁のまま
    expect(countUpFrame('1.2', 0.5)).toBe('0.6')
    expect(countUpFrame('1.25', 0.5)).toBe('0.63')
    // 小さい整数も途中で届く（1 × 0.6 → 1）
    expect(countUpFrame('1 / 2', 0.6, [1])).toBe('1 / 2')
    expect(countUpFrame('1 / 2', 0.4, [1])).toBe('0 / 2')
    // 1 未満の進みでも数字でない部分は変わらない
    expect(countUpFrame('6,705', 0.999)).toBe('6,698')
  })

  it('数字を含むかを返す（「—」は動かさない）', () => {
    expect(hasNumber('—')).toBe(false)
    expect(hasNumber('1.2')).toBe(true)
    expect(hasNumber('¥0')).toBe(true)
  })
})
