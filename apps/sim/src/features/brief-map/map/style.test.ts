import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_MAP_STYLE_URL, mapStyleUrl, webglAvailable } from './style'

// 地図の背景の提供元（functional.md R9、threat.md AUTH-5）

describe('mapStyleUrl', () => {
  it('既定は OpenFreeMap の positron、off なら使わない、それ以外は環境変数の値そのまま', () => {
    expect(mapStyleUrl(undefined)).toBe(DEFAULT_MAP_STYLE_URL)
    expect(DEFAULT_MAP_STYLE_URL).toBe('https://tiles.openfreemap.org/styles/positron')
    expect(mapStyleUrl('off')).toBeNull()
    expect(mapStyleUrl(' https://example.test/style.json ')).toBe('https://example.test/style.json')
  })

  it('AUTH-5: スタイルの URL は旅の ID や画面の path から作らない（引数は環境変数だけ）', () => {
    const src = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'style.ts'),
      'utf8',
    )
    expect(src).not.toMatch(/location|useParams|tripId/)
  })

  it('UC-9f: sim の HTML は referrer を strict-origin にする（タイルの要求で path を外に出さない）', () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const html = readFileSync(path.resolve(here, '../../../../index.html'), 'utf8')
    expect(html).toMatch(/<meta name="referrer" content="strict-origin"\s*\/?>/)
  })

  it('jsdom には WebGL2 が無い', () => {
    expect(webglAvailable()).toBe(false)
  })
})
