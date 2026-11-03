import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { renderBeepWav, renderChimeWav, SAMPLE_RATE } from '../../scripts/sounds'

const assets = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/sounds')

function header(buf: Uint8Array) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const text = (o: number) => String.fromCharCode(...buf.subarray(o, o + 4))
  return {
    riff: text(0),
    wave: text(8),
    channels: view.getUint16(22, true),
    rate: view.getUint32(24, true),
    bits: view.getUint16(34, true),
    dataBytes: view.getUint32(40, true),
  }
}

describe('音源（自作の wav。A と B で同じファイル）', () => {
  it('chime.wav は 2 音・0.6 秒、beep.wav は 1 kHz の短音。生成スクリプトの出力とリポジトリのファイルが一致する', () => {
    const chime = renderChimeWav()
    const beep = renderBeepWav()
    const h = header(chime)
    expect(h).toMatchObject({
      riff: 'RIFF',
      wave: 'WAVE',
      channels: 1,
      rate: SAMPLE_RATE,
      bits: 16,
    })
    expect(h.dataBytes / 2 / SAMPLE_RATE).toBeCloseTo(0.6, 2)
    expect(header(beep).dataBytes / 2 / SAMPLE_RATE).toBeLessThan(0.12)
    expect(new Uint8Array(readFileSync(path.join(assets, 'chime.wav')))).toEqual(chime)
    expect(new Uint8Array(readFileSync(path.join(assets, 'beep.wav')))).toEqual(beep)
  })
})
