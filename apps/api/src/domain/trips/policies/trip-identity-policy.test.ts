import { ScriptedRandom } from '../../../../tests/factories/trips.js'
import { MAX_SEED } from '../rules/trip-rules.js'
import {
  canonicalJson,
  createTripIdentity,
  idempotencyKeyMaterial,
  ownerTokenMaterial,
} from './trip-identity-policy.js'
import { randomBytes } from 'node:crypto'

describe('createTripIdentity（R7）', () => {
  it('UC-7a: id は英数 8 文字、seed は 0〜2^32−1', () => {
    for (let i = 0; i < 200; i++) {
      const { id, seed } = createTripIdentity((n) => new Uint8Array(randomBytes(n)))
      expect(id).toMatch(/^[A-Za-z0-9]{8}$/)
      expect(Number.isInteger(seed)).toBe(true)
      expect(seed).toBeGreaterThanOrEqual(0)
      expect(seed).toBeLessThanOrEqual(MAX_SEED)
    }
  })

  it('乱数を差し替えると決まった値になる（0 → A、0xff は棄却して次のバイトを使う）', () => {
    const random = new ScriptedRandom([0, 255])
    expect(createTripIdentity((n) => random.bytes(n))).toEqual({ id: 'AAAAAAAA', seed: MAX_SEED })
    const skip = [255, 255, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
    let calls = 0
    const identity = createTripIdentity((n) =>
      calls++ === 0 ? Uint8Array.from(skip) : new Uint8Array(n),
    )
    expect(identity).toEqual({ id: 'BBBBBBBB', seed: 0 })
  })

  it('248 以上のバイトばかりなら、足りるまで引き直す', () => {
    let calls = 0
    const identity = createTripIdentity((n) => new Uint8Array(n).fill(calls++ === 0 ? 250 : 61))
    expect(identity.id).toBe('99999999')
  })
})

describe('トークンとキーの材料・body の正規形', () => {
  it('所有者トークンと冪等キーの材料は用途ごとに別の接頭辞', () => {
    expect(ownerTokenMaterial('k')).not.toBe(idempotencyKeyMaterial('k'))
    expect(ownerTokenMaterial('k')).toContain('k')
  })

  it('canonicalJson はキーの順に依らない', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } })).toBe(
      canonicalJson({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }),
    )
    expect(canonicalJson({ a: 1, skip: undefined })).toBe('{"a":1}')
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }))
  })
})
