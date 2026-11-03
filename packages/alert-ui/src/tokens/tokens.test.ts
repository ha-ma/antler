import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadDesignTokens, renderTokensCss, renderTokensTs } from '../../scripts/tokens'

const here = path.dirname(fileURLToPath(import.meta.url))
const committed = (file: string) => readFileSync(path.join(here, file), 'utf-8')

describe('UC-9 トークン', () => {
  it('UC-9a: 生成スクリプトの出力がリポジトリの tokens.css・tokens.ts と一致する', () => {
    const tokens = loadDesignTokens()
    expect(committed('tokens.css'), 'npm run build:tokens -w @antler/alert-ui').toBe(
      renderTokensCss(tokens),
    )
    expect(committed('tokens.ts'), 'npm run build:tokens -w @antler/alert-ui').toBe(
      renderTokensTs(tokens),
    )
  })

  it('UC-9b: --alert-* は trip と night で同じ値（テーマで変えない）', () => {
    const tokens = loadDesignTokens()
    const alerts = tokens.color.tokens.filter((t) => t.name.includes('alert-'))
    expect(alerts.map((t) => t.name)).toEqual([
      'alert-safe',
      'on-alert-safe',
      'alert-zone',
      'on-alert-zone',
      'alert-danger',
      'on-alert-danger',
    ])
    for (const t of alerts) {
      expect(t.value.trip, t.name).toBe(t.value.night)
    }
    const css = committed('tokens.css')
    expect(css).toContain('--alert-danger: #E2492C;')
    // alert-* はテーマごとのブロックではなく :root に 1 回だけ出す
    expect(css.match(/--alert-danger:/g)).toHaveLength(1)
  })
})
