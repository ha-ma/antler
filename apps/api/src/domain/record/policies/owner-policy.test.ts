import { describe, expect, it } from 'vitest'
import { isOwnerTokenHash, OWNER_TOKEN_PATTERN } from './owner-policy.js'

// docs/specs/record/threat.md SEC-1（長さ一定の比較）

const HASH = 'a1'.repeat(32)

describe('isOwnerTokenHash', () => {
  it('SEC-1: 同じハッシュ → true', () => {
    expect(isOwnerTokenHash(HASH, HASH)).toBe(true)
  })

  it('SEC-1: 1 文字違い（先頭・末尾）→ false', () => {
    expect(isOwnerTokenHash(HASH, `b${HASH.slice(1)}`)).toBe(false)
    expect(isOwnerTokenHash(HASH, `${HASH.slice(0, -1)}2`)).toBe(false)
  })

  it('SEC-1: 長さが違う・空 → false', () => {
    expect(isOwnerTokenHash(HASH, HASH.slice(0, 63))).toBe(false)
    expect(isOwnerTokenHash(HASH, `${HASH}0`)).toBe(false)
    expect(isOwnerTokenHash(HASH, '')).toBe(false)
    expect(isOwnerTokenHash('', '')).toBe(false)
  })

  it('所有者トークンの形は 16 進 64 文字', () => {
    expect(OWNER_TOKEN_PATTERN.test('0f'.repeat(32))).toBe(true)
    expect(OWNER_TOKEN_PATTERN.test('0F'.repeat(32))).toBe(false)
    expect(OWNER_TOKEN_PATTERN.test('0f'.repeat(31))).toBe(false)
  })
})
