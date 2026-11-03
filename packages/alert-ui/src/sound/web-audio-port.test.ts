import { describe, expect, it, vi } from 'vitest'
import { WebAudioPort, type WebAudioDeps } from './web-audio-port'

function fakes() {
  const created: FakeContext[] = []
  const started: string[] = []
  class FakeContext {
    state = 'suspended'
    destination = {}
    constructor() {
      created.push(this)
    }
    resume() {
      this.state = 'running'
      return Promise.resolve()
    }
    decodeAudioData(buf: ArrayBuffer) {
      return Promise.resolve({ name: new TextDecoder().decode(buf) })
    }
    createBufferSource() {
      const source = {
        buffer: null as { name: string } | null,
        connect: () => undefined,
        start: () => started.push(source.buffer?.name ?? '?'),
      }
      return source
    }
  }
  const spoken: { lang: string; text: string }[] = []
  const synth = {
    speak: (u: { lang: string; text: string }) => spoken.push({ lang: u.lang, text: u.text }),
    cancel: vi.fn(),
  }
  const deps: WebAudioDeps = {
    AudioContext: FakeContext as unknown as WebAudioDeps['AudioContext'],
    fetch: (url: string) =>
      Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new TextEncoder().encode(url).buffer),
      }),
    speechSynthesis: synth,
    Utterance: class {
      lang = ''
      constructor(public text: string) {}
    } as unknown as WebAudioDeps['Utterance'],
  }
  return { deps, created, started, spoken, synth }
}

describe('WebAudioPort', () => {
  it('IDEM-2: unlock を 2 回呼んでも AudioContext は 1 つ。chime / beep は読み込んだ音源を鳴らす', async () => {
    const f = fakes()
    const port = new WebAudioPort({ chime: 'chime.wav', beep: 'beep.wav' }, f.deps)
    await port.unlock()
    await port.unlock()
    expect(f.created).toHaveLength(1)
    port.playChime()
    port.playBeep()
    expect(f.started).toEqual(['chime.wav', 'beep.wav'])
  })

  it('読み上げは言語タグ付きで speechSynthesis に渡す。zh は zh-TW', () => {
    const f = fakes()
    const port = new WebAudioPort({ chime: 'c', beep: 'b' }, f.deps)
    port.speak('zh', '前方有鹿')
    port.cancelSpeech()
    expect(f.spoken).toEqual([{ lang: 'zh-TW', text: '前方有鹿' }])
    expect(f.synth.cancel).toHaveBeenCalled()
  })

  it('FAIL-4 の前提: speechSynthesis が無ければ speak は例外（呼び出し側がビープを続ける）', () => {
    const f = fakes()
    const port = new WebAudioPort(
      { chime: 'c', beep: 'b' },
      { ...f.deps, speechSynthesis: undefined },
    )
    expect(() => port.speak('ja', '前方に鹿がいます')).toThrow()
    expect(() => port.cancelSpeech()).not.toThrow()
  })

  it('解除前に鳴らそうとすると例外（canPlay の扱いは呼び出し側）', () => {
    const f = fakes()
    const port = new WebAudioPort({ chime: 'c', beep: 'b' }, f.deps)
    expect(() => port.playBeep()).toThrow()
  })

  it('FAIL-7: AudioContext が無い端末では unlock が同期で投げずに reject する', async () => {
    const f = fakes()
    const Missing = class {
      constructor() {
        throw new Error('AudioContext が使えません')
      }
    } as unknown as WebAudioDeps['AudioContext']
    const port = new WebAudioPort({ chime: 'c', beep: 'b' }, { ...f.deps, AudioContext: Missing })
    const result = port.unlock()
    await expect(result).rejects.toThrow('AudioContext')
  })

  it('音源の読み込みに失敗したら unlock が例外', async () => {
    const f = fakes()
    const port = new WebAudioPort(
      { chime: 'c', beep: 'b' },
      {
        ...f.deps,
        fetch: () =>
          Promise.resolve({ ok: false, arrayBuffer: () => Promise.reject(new Error('404')) }),
      },
    )
    await expect(port.unlock()).rejects.toThrow()
  })
})
