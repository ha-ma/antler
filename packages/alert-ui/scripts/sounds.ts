// チャイムとビープの wav を作る（自作の音源。A と B で同じファイルを使う。ch5「音源ファイルは A/B で共通」）。
// 書き出しは build-sounds.ts。wav.test.ts が、書き出し済みのファイルとこの出力の一致を確かめる。
// 毎回同じバイト列になるよう、乱数や時刻を使わない。

export const SAMPLE_RATE = 22_050

type Tone = { hz: number; seconds: number; gain: number }

/** 短い立ち上がりと指数の減衰をかけたサイン波を並べる。 */
function synth(tones: Tone[]): Float32Array {
  const total = tones.reduce((n, t) => n + Math.round(t.seconds * SAMPLE_RATE), 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const t of tones) {
    const n = Math.round(t.seconds * SAMPLE_RATE)
    const attack = Math.round(0.005 * SAMPLE_RATE)
    for (let i = 0; i < n; i++) {
      const env = Math.min(1, i / attack) * Math.exp((-4 * i) / n)
      out[offset + i] = t.gain * env * Math.sin((2 * Math.PI * t.hz * i) / SAMPLE_RATE)
    }
    offset += n
  }
  return out
}

/** 16 bit・モノラルの PCM wav。 */
export function encodeWav(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const ascii = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i)
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  samples.forEach((s, i) => {
    view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, s)) * 32767), true)
  })
  return bytes
}

/** チャイム: 2 音・合計 0.6 秒（ゾーン進入）。 */
export function renderChimeWav(): Uint8Array {
  return encodeWav(
    synth([
      { hz: 880, seconds: 0.3, gain: 0.6 },
      { hz: 659.25, seconds: 0.3, gain: 0.6 },
    ]),
  )
}

/** ビープ: 1 kHz の短音（danger の間、距離に応じた間隔で繰り返す）。 */
export function renderBeepWav(): Uint8Array {
  return encodeWav(synth([{ hz: 1000, seconds: 0.08, gain: 0.9 }]))
}
