// 書き込みの権利（docs/specs/stop-events/functional.md R9、threat.md）。
// ownerToken は HMAC-SHA256 の 16 進 64 文字（plan-trip R7）。api は SHA-256 のハッシュだけを持つ。

export const OWNER_TOKEN_PATTERN = /^[0-9a-f]{64}$/

/** 受けたトークンの形が正しいか（違えば照合せずに拒む） */
export function isOwnerTokenShape(token: string | undefined): token is string {
  return typeof token === 'string' && OWNER_TOKEN_PATTERN.test(token)
}

/**
 * 保存したハッシュと、受けたトークンのハッシュが同じか。
 * どちらも SHA-256 の 16 進なので、比べる時間から元のトークンは分からない（threat.md Info）
 */
export function isTripOwner(storedHash: string, presentedHash: string): boolean {
  return storedHash.length === presentedHash.length && storedHash === presentedHash
}
