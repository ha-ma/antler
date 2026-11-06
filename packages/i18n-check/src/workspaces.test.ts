import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 受け入れ（docs/specs/i18n/functional.md AC-1・INV-3）: 4 つの workspace の i18n の検査が `npm test` で回る形になっている。
// どれかの workspace が test の script を失う・i18n-tables.test.ts を消すと、検査が黙って止まるのでここで落とす。

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const WORKSPACES = ['apps/sim', 'apps/pwa', 'packages/trip', 'packages/alert-ui'] as const

type Pkg = { scripts?: Record<string, string>; workspaces?: string[] }
const readPkg = (dir: string): Pkg =>
  JSON.parse(readFileSync(`${ROOT}${dir}/package.json`, 'utf-8')) as Pkg

describe('AC-1: 4 つの workspace の i18n の検査が npm test で回る', () => {
  it.each(WORKSPACES)('AC-1: %s に i18n-tables.test.ts と test の script がある', (dir) => {
    expect(existsSync(`${ROOT}${dir}/src/i18n-tables.test.ts`)).toBe(true)
    expect(readPkg(dir).scripts?.['test']).toMatch(/vitest run/)
  })

  it('INV-3: alert-ui のテストが npm test で回る（test の script）', () => {
    expect(readPkg('packages/alert-ui').scripts?.['test']).toBe('vitest run src')
  })

  it('AC-1: ルートの npm test が全 workspace の test を回す', () => {
    expect(readPkg('.').scripts?.['test']).toContain('--workspaces')
  })
})
