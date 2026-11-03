import { ZoneCollectionSchema, type ZoneCollection } from './zone-db'

// 生成済みのゾーン DB（data/zones.geojson）の読み方。
// B の PWA はビルド時に同梱し（Vite がファイルを出力して URL に置き換える）、Service Worker でキャッシュする。
// A は API（/api/zones.geojson）からも同じファイルを受け取れる。どちらも parseZoneCollection で形を確かめてから使う。

export const ZONES_GEOJSON_URL = new URL('../data/zones.geojson', import.meta.url).href

/** 文字列か JSON.parse 済みの値を検証してゾーン DB にする。形が違えば例外。 */
export function parseZoneCollection(input: string | unknown): ZoneCollection {
  const value: unknown = typeof input === 'string' ? JSON.parse(input) : input
  const parsed = ZoneCollectionSchema.safeParse(value)
  if (!parsed.success) throw new TypeError(`ゾーン DB の形が違います: ${parsed.error.message}`)
  return parsed.data
}

/**
 * ファイルの `hash` が features から計算し直した sha256 と一致するか（手で直した・壊れたファイルを見つける）。
 * A と B が同じファイルを使っているかの確認にも、この値（`hash`）を比べる。ブラウザと Node の Web Crypto を使う。
 */
export async function verifyZoneHash(input: string | unknown): Promise<boolean> {
  const value: unknown = typeof input === 'string' ? JSON.parse(input) : input
  if (!value || typeof value !== 'object') return false
  const { hash, features } = value as { hash?: unknown; features?: unknown }
  if (typeof hash !== 'string' || !Array.isArray(features)) return false
  const bytes = new TextEncoder().encode(JSON.stringify(features))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return hex === hash
}
