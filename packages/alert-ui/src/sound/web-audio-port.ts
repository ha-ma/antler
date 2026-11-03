import type { Lang } from '../i18n/i18n'
import type { AudioPort } from './sound-controller'

// ブラウザの音の出力（Web Audio で wav を鳴らし、speechSynthesis で読み上げる）。
// 読み上げ音声ファイル 4 言語は保留（functional.md の Questions）。それまではブラウザの読み上げで鳴らす。
// 依存（AudioContext・fetch・speechSynthesis）は差し込めるようにしてある（テストと、使えない端末のため）。

export type SoundUrls = { chime: string; beep: string }

type BufferLike = unknown
type ContextLike = {
  readonly destination: unknown
  resume(): Promise<void>
  decodeAudioData(data: ArrayBuffer): Promise<BufferLike>
  createBufferSource(): {
    buffer: BufferLike
    connect(destination: unknown): unknown
    start(): void
  }
}
type UtteranceLike = { lang: string; text: string }

export type WebAudioDeps = {
  AudioContext: new () => ContextLike
  fetch: (url: string) => Promise<{ ok: boolean; arrayBuffer(): Promise<ArrayBuffer> }>
  speechSynthesis: { speak(u: UtteranceLike): void; cancel(): void } | undefined
  Utterance: new (text: string) => UtteranceLike
}

const SPEECH_LANG: Record<Lang, string> = { ja: 'ja-JP', en: 'en-US', zh: 'zh-TW', ko: 'ko-KR' }

/** ブラウザの実物を使う既定の依存。無い端末（古いブラウザ）では unlock が例外になる。 */
export function browserAudioDeps(): WebAudioDeps {
  const g = globalThis as unknown as {
    AudioContext?: new () => ContextLike
    webkitAudioContext?: new () => ContextLike
    speechSynthesis?: WebAudioDeps['speechSynthesis']
    SpeechSynthesisUtterance?: WebAudioDeps['Utterance']
  }
  const Missing = class {
    constructor() {
      throw new Error('AudioContext が使えません')
    }
  } as unknown as new () => ContextLike
  return {
    AudioContext: g.AudioContext ?? g.webkitAudioContext ?? Missing,
    fetch: (url) => fetch(url),
    speechSynthesis: g.speechSynthesis,
    Utterance:
      g.SpeechSynthesisUtterance ??
      class {
        lang = ''
        constructor(public text: string) {}
      },
  }
}

export class WebAudioPort implements AudioPort {
  private readonly urls: SoundUrls
  private readonly deps: WebAudioDeps
  private ctx: ContextLike | null = null
  private buffers: { chime: BufferLike; beep: BufferLike } | null = null
  private loading: Promise<void> | null = null

  constructor(urls: SoundUrls, deps: WebAudioDeps = browserAudioDeps()) {
    this.urls = urls
    this.deps = deps
  }

  /** AudioContext を 1 つだけ作り、音源を 1 回だけ読み込む。 */
  unlock(): Promise<void> {
    this.ctx ??= new this.deps.AudioContext()
    const ctx = this.ctx
    this.loading ??= (async () => {
      await ctx.resume()
      const [chime, beep] = await Promise.all([
        this.load(ctx, this.urls.chime),
        this.load(ctx, this.urls.beep),
      ])
      this.buffers = { chime, beep }
    })().catch((error: unknown) => {
      this.loading = null
      throw error
    })
    return this.loading
  }

  playChime(): void {
    this.play('chime')
  }

  playBeep(): void {
    this.play('beep')
  }

  speak(lang: Lang, text: string): void {
    const synth = this.deps.speechSynthesis
    if (!synth) throw new Error('speechSynthesis が使えません')
    const u = new this.deps.Utterance(text)
    u.lang = SPEECH_LANG[lang]
    synth.speak(u)
  }

  cancelSpeech(): void {
    this.deps.speechSynthesis?.cancel()
  }

  private async load(ctx: ContextLike, url: string): Promise<BufferLike> {
    const res = await this.deps.fetch(url)
    if (!res.ok) throw new Error(`音源を読み込めません: ${url}`)
    return ctx.decodeAudioData(await res.arrayBuffer())
  }

  private play(kind: 'chime' | 'beep'): void {
    if (!this.ctx || !this.buffers) throw new Error('音が解除されていません')
    const source = this.ctx.createBufferSource()
    source.buffer = this.buffers[kind]
    source.connect(this.ctx.destination)
    source.start()
  }
}
