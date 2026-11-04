import { CaptureConflictError, CaptureInputError } from '../errors/capture-errors.js'
import {
  canonicalCaptureJson,
  captureBodyMaterial,
  captureKey,
  decideOnExistingCapture,
  imageExtension,
  imageFileName,
  logicalImagePath,
} from './capture-identity-policy.js'

describe('capture-identity-policy', () => {
  it('API-1m: key は id の小文字。パスに使えない形は CaptureInputError', () => {
    expect(captureKey('cap_A')).toBe('cap_a')
    expect(captureKey('cap_a')).toBe('cap_a')
    expect(captureKey('cap_0A1b2C')).toBe('cap_0a1b2c')
    for (const bad of [
      '',
      'cap_',
      'cap_../x',
      'cap_a/b',
      'x_abc',
      '../cap_a',
      'cap_a.json',
      'cap_a b',
    ]) {
      expect(() => captureKey(bad)).toThrow(CaptureInputError)
    }
  })

  it('API-1o: 論理のパスと実ファイル名は形式から決まる', () => {
    expect(imageExtension('jpeg')).toBe('jpg')
    expect(imageExtension('png')).toBe('png')
    expect(logicalImagePath('cap_Abc', 'jpeg')).toBe('captures/cap_Abc.jpg')
    expect(logicalImagePath('cap_abc', 'png')).toBe('captures/cap_abc.png')
    expect(imageFileName('cap_abc', 'a'.repeat(64), 'jpeg')).toBe(`cap_abc-${'a'.repeat(12)}.jpg`)
  })

  it('API-1b: 本文の正準形はキーの順に依らず、入れ子も辞書順にそろう', () => {
    const a = { b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } }
    const b = { a: { c: null, d: [3, { x: 2, y: 1 }] }, b: 1 }
    expect(canonicalCaptureJson(a)).toBe(canonicalCaptureJson(b))
    expect(canonicalCaptureJson(a)).toBe('{"a":{"c":null,"d":[3,{"x":2,"y":1}]},"b":1}')
    // 配列の順は意味があるので保つ
    expect(canonicalCaptureJson([2, 1])).not.toBe(canonicalCaptureJson([1, 2]))
  })

  it('API-1c: 本文の材料 = 正準の Capture + 改行 + 画像の sha256。画像か Capture が違えば変わる', () => {
    const capture = { id: 'cap_a', consent: true }
    const sha = 'f'.repeat(64)
    expect(captureBodyMaterial(capture, sha)).toBe(`{"consent":true,"id":"cap_a"}\n${sha}`)
    expect(captureBodyMaterial(capture, sha)).not.toBe(captureBodyMaterial(capture, 'e'.repeat(64)))
    expect(captureBodyMaterial(capture, sha)).not.toBe(
      captureBodyMaterial({ ...capture, id: 'cap_b' }, sha),
    )
  })

  it('API-1b・API-1c: 既にあるものは本文のハッシュが同じなら replay、違う・読めないなら CaptureConflictError', () => {
    expect(decideOnExistingCapture('abc', 'abc')).toBe('replay')
    expect(() => decideOnExistingCapture('abc', 'abd')).toThrow(CaptureConflictError)
    expect(() => decideOnExistingCapture(null, 'abc')).toThrow(CaptureConflictError)
  })
})
