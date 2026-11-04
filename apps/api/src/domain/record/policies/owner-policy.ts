// 旅の所有者の照合（docs/specs/record/functional.md R2・R10、threat.md）。
// 所有者トークン = HMAC(OWNER_TOKEN_SECRET, 冪等キー)（plan-trip R7）。api はトークンの SHA-256 だけを持つので、
// 送られたトークンの SHA-256 を保存したハッシュと比べる。比較は途中で抜けない（一致した長さを時間で漏らさない）。

/** 所有者トークンの形（HMAC-SHA256 の 16 進 64 文字。node:crypto の hex は小文字） */
export const OWNER_TOKEN_PATTERN = /^[0-9a-f]{64}$/

/** 保存したハッシュと、送られたトークンのハッシュが同じか（長さ一定の比較）。 */
export function isOwnerTokenHash(storedHash: string, presentedHash: string): boolean {
  if (storedHash.length === 0 || storedHash.length !== presentedHash.length) return false
  let diff = 0
  for (let i = 0; i < storedHash.length; i += 1) {
    diff |= storedHash.charCodeAt(i) ^ presentedHash.charCodeAt(i)
  }
  return diff === 0
}
