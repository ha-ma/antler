import { describe, expect, it } from 'vitest'
import { loadDesignTokens } from '../../scripts/tokens'

// UC-10c: 3 状態の文字と背景のコントラスト（WCAG 2.1 の相対輝度）。tokens.json から計算する。

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

const color = (name: string) => {
  const t = loadDesignTokens().color.tokens.find((c) => c.name === name)
  if (!t?.value['trip']) throw new Error(`トークンがありません: ${name}`)
  return t.value['trip']
}

describe('UC-10c コントラスト', () => {
  it('safe / zone は 4.5:1 以上', () => {
    expect(contrast(color('alert-safe'), color('on-alert-safe'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(color('alert-zone'), color('on-alert-zone'))).toBeGreaterThanOrEqual(4.5)
  })

  it('danger は 3:1 以上（4.02:1。文字をすべて大きな文字＝24px 以上か 19px 以上の太字にして WCAG の大きな文字の基準で満たす）', () => {
    // ch5 の「4.5:1 以上（赤底×白文字で確認済み）」とは食い違う。確認待ち（PR に記載）
    const ratio = contrast(color('alert-danger'), color('on-alert-danger'))
    expect(ratio).toBeGreaterThanOrEqual(3)
    expect(ratio).toBeLessThan(4.5)
  })
})
