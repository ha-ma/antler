import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadBundledZones } from './zones-loader'

const geojson = readFileSync(
  resolve(process.cwd(), '../../packages/zones/data/zones.geojson'),
  'utf8',
)

describe('UC-3 ゾーン DB の照合', () => {
  it('UC-3a: 同梱の zones.geojson が verifyZoneHash を通り、読み込まれる', async () => {
    const zones = await loadBundledZones(() => Promise.resolve(geojson))
    expect(zones.features.length).toBeGreaterThan(0)
    expect(zones.features[0]?.id).toBe('R12-kamuikotan-1')
  })

  it('UC-3b: ハッシュが合わない（features を 1 文字書き換えた）・形が違う・fetch の失敗 → 例外', async () => {
    const tampered = geojson.replace('R12-kamuikotan-1', 'R12-kamuikotan-9')
    await expect(loadBundledZones(() => Promise.resolve(tampered))).rejects.toThrow(/ハッシュ/)
    await expect(
      loadBundledZones(() => Promise.resolve('{"hash":"x","features":[]}')),
    ).rejects.toThrow()
    await expect(loadBundledZones(() => Promise.resolve('not json'))).rejects.toThrow()
    await expect(loadBundledZones(() => Promise.reject(new Error('offline')))).rejects.toThrow(
      'offline',
    )
  })
})
