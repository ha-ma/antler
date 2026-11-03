import { MAX_SEED, TRIP_ID_ALPHABET, TRIP_ID_LENGTH } from '../rules/trip-rules.js'

// 旅の id・seed と、所有者トークン・冪等キーのハッシュの材料（docs/specs/plan-trip/functional.md R7・R8）。
// 乱数は呼び出し側が渡す（application/ports/security/random-source.ts を通して差し替えられる）。

/** n バイトの暗号論的乱数を返す関数 */
export type RandomBytes = (n: number) => Uint8Array

export type TripIdentity = { id: string; seed: number }

/** 62 文字に偏りなく落とすため、62 × 4 = 248 未満のバイトだけを使う（棄却法） */
const ACCEPT_BELOW = Math.floor(256 / TRIP_ID_ALPHABET.length) * TRIP_ID_ALPHABET.length

/** 英数 8 文字の id と、0〜2^32−1 の seed を作る。 */
export function createTripIdentity(randomBytes: RandomBytes): TripIdentity {
  let id = ''
  while (id.length < TRIP_ID_LENGTH) {
    for (const byte of randomBytes(TRIP_ID_LENGTH * 2)) {
      if (byte >= ACCEPT_BELOW) continue
      id += TRIP_ID_ALPHABET.charAt(byte % TRIP_ID_ALPHABET.length)
      if (id.length === TRIP_ID_LENGTH) break
    }
  }
  const b = randomBytes(4)
  const seed = (((b[0] ?? 0) << 24) | ((b[1] ?? 0) << 16) | ((b[2] ?? 0) << 8) | (b[3] ?? 0)) >>> 0
  return { id, seed: Math.min(seed, MAX_SEED) }
}

/**
 * 所有者トークンの材料。トークンは「この材料をサーバーの秘密で署名した HMAC」なので、同じキーの再送
 * （R8: 端末があきらめたあとの再試行）でも同じトークンを返せ、秘密を知らなければキーから計算できない。
 * api はトークンそのものを保存せず、そのハッシュだけを持つ（R7）。
 */
export function ownerTokenMaterial(idempotencyKey: string): string {
  return `antler:owner-token:v1:${idempotencyKey}`
}

/** 冪等キーを保存するときのハッシュの材料（キーそのものは保存しない）。 */
export function idempotencyKeyMaterial(idempotencyKey: string): string {
  return `antler:idempotency-key:v1:${idempotencyKey}`
}

/** body の同一性を比べるための正規形（キーを並べ替えた JSON）。 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}
