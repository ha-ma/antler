import {
  parseZoneCollection,
  verifyZoneHash,
  ZONES_GEOJSON_URL,
  type ZoneCollection,
} from '@antler/zones'

// 同梱のゾーン DB を読み、ハッシュと形を確かめる（pwa-drive R3）。どれかに失敗したら使わない（例外）。

export async function loadBundledZones(
  fetchText: (url: string) => Promise<string> = defaultFetchText,
  url: string = ZONES_GEOJSON_URL,
): Promise<ZoneCollection> {
  const text = await fetchText(url)
  const value: unknown = JSON.parse(text)
  if (!(await verifyZoneHash(value))) throw new Error('ゾーン DB のハッシュが合いません')
  return parseZoneCollection(value)
}

async function defaultFetchText(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`ゾーン DB を読めません（${res.status}）`)
  return res.text()
}
