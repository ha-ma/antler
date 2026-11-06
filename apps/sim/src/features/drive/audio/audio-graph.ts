import { createRng } from '../domain/rng'
import type { AudioLevels } from './mix'
import { SAMPLE_FILES, type SampleName } from './music-tracks'
import { NOTIFY_TONES } from './notify-tone'

// Web Audio の音のグラフ（docs/specs/drive-audio-chat/functional.md R2〜R4・R8・R9、drive-sound-tourism S1〜S12）。
// 何をどの大きさで鳴らすかは mix.ts・brake-voice.ts の純粋関数と DriveAudio が決め、ここは値を AudioParam に渡すだけにする。
// - エンジン・ブレーキのこすれ・通知音・衝突のドスンはその場で合成する（自作）
// - BGM は <audio> で流し（曲全体を展開しない）、MediaElementAudioSourceNode で BGM の大きさにつなぐ
// - ブレーキの鳴き・衝突の録音（CC0）は小さいので、start の後に読み込んで展開しておく
// ノードは作り直さず（短い音のノードだけ作って終わったら外す）、値は setTargetAtTime でならす。

export type MusicEvent = 'ended' | 'error' | 'blocked'

/** 音の差し込み口（テストではフェイク） */
export interface AudioGraphPort {
  resume(): Promise<void>
  suspend(): Promise<void>
  /** AudioContext の時刻（秒） */
  currentTime(): number
  setLevels(levels: AudioLevels): void
  /** 曲を流す（同じ URL なら続きから）。null なら一時停止（S3〜S5） */
  setMusic(url: string | null): void
  /** 曲が終わった・読めなかった・再生を拒まれた（S4・S7） */
  onMusicEvent(listener: (event: MusicEvent) => void): void
  /** 短い音（鳴き・衝突）を読み込む。失敗はその音だけ鳴らさない（S10） */
  loadSamples(base: string): void
  /** ブレーキの鳴きの録音を 1 回（S9） */
  playSqueal(gain: number): void
  /** 衝突の録音と自作のドスンを 1 回（S12） */
  playCrash(gain: number): void
  /** 会話の通知音。tones は鳴らす音の数（緑 2・琥珀 1。S11） */
  playNotify(gain: number, tones: number): void
  close(): void
}

export type WebAudioGraphOptions = {
  createContext?: () => AudioContext
  /** BGM の <audio> を作る（テストではフェイク） */
  createMedia?: () => HTMLAudioElement
  /** 短い音の中身を取る */
  fetchBytes?: (url: string) => Promise<ArrayBuffer>
}

/** 値の変化をならす時定数（秒）。0.1 秒程度で目標に近づく */
const SMOOTH_S = 0.03
/** 赤で BGM を下げるときの時定数（0.15 秒以内に下げる） */
const MUSIC_DOWN_S = 0.04
const NOISE_SECONDS = 2
const NOISE_SEED = 1
/** タイヤのこすれの帯域（S8） */
const BRAKE_BAND_HZ = 900
const BRAKE_BAND_Q = 0.7
/** 衝突のドスン（S12）: 80 → 35 Hz に下がる正弦波と、低域の雑音 */
const THUD_FROM_HZ = 80
const THUD_TO_HZ = 35
const THUD_S = 0.45
const THUD_NOISE_HZ = 300
const THUD_NOISE_S = 0.3
const THUD_LEVEL = 0.9
/** 音符の終わりから 0 まで下げる時間（秒）。止めるのはその少し後 */
const RELEASE_S = 0.2
const STOP_AFTER_S = 0.3

/** 種付きの白色雑音（mulberry32。Math.random を使わない。同じ種 → 同じ雑音。S8） */
export function noiseSamples(length: number, seed: number = NOISE_SEED): Float32Array {
  const rng = createRng(seed)
  const data = new Float32Array(length)
  for (let i = 0; i < length; i++) data[i] = (rng() * 2 - 1) * 0.9
  return data
}

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * NOISE_SECONDS)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  buffer.getChannelData(0).set(noiseSamples(length))
  return buffer
}

const defaultFetch = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${String(res.status)}`)
    return res.arrayBuffer()
  })

export class WebAudioGraph implements AudioGraphPort {
  private readonly ctx: AudioContext
  private readonly master: GainNode
  private readonly engineOsc: OscillatorNode
  private readonly engineSub: OscillatorNode
  private readonly engineFilter: BiquadFilterNode
  private readonly engineGain: GainNode
  private readonly brakeGain: GainNode
  private readonly absGain: GainNode
  private readonly absLfo: OscillatorNode
  private readonly absDepth: GainNode
  private readonly musicGain: GainNode
  /** 鳴きの録音の出口。ABS の断続をこすれと同じ LFO で掛ける（S9） */
  private readonly squealBus: GainNode
  private readonly noise: AudioBuffer
  private readonly sources: AudioScheduledSourceNode[] = []
  private readonly samples = new Map<SampleName, AudioBuffer>()
  private readonly createMedia: () => HTMLAudioElement
  private readonly fetchBytes: (url: string) => Promise<ArrayBuffer>
  private media: HTMLAudioElement | null = null
  private mediaUrl: string | null = null
  private musicListener: ((event: MusicEvent) => void) | null = null
  private samplesRequested = false

  constructor(options: WebAudioGraphOptions = {}) {
    const ctx = (options.createContext ?? (() => new AudioContext()))()
    this.ctx = ctx
    this.createMedia = options.createMedia ?? (() => new Audio())
    this.fetchBytes = options.fetchBytes ?? defaultFetch
    this.master = ctx.createGain()
    this.master.connect(ctx.destination)
    this.noise = noiseBuffer(ctx)

    // エンジン: のこぎり波と 1 オクターブ下の矩形波を、回転で開くローパスに通す
    this.engineOsc = ctx.createOscillator()
    this.engineOsc.type = 'sawtooth'
    this.engineSub = ctx.createOscillator()
    this.engineSub.type = 'square'
    this.engineFilter = ctx.createBiquadFilter()
    this.engineFilter.type = 'lowpass'
    this.engineGain = this.silentGain()
    this.engineOsc.connect(this.engineFilter)
    this.engineSub.connect(this.engineFilter)
    this.engineFilter.connect(this.engineGain)
    this.engineGain.connect(this.master)

    // ブレーキのこすれ: 雑音を 900 Hz の帯域で絞り、ABS の断続（14 Hz の矩形の LFO）を掛ける（S8）
    const brakeNoise = this.loopNoise()
    const brakeBand = ctx.createBiquadFilter()
    brakeBand.type = 'bandpass'
    brakeBand.frequency.value = BRAKE_BAND_HZ
    brakeBand.Q.value = BRAKE_BAND_Q
    this.absGain = ctx.createGain()
    this.absLfo = ctx.createOscillator()
    this.absLfo.type = 'square'
    this.absDepth = this.silentGain()
    this.absLfo.connect(this.absDepth)
    this.absDepth.connect(this.absGain.gain)
    this.brakeGain = this.silentGain()
    brakeNoise.connect(brakeBand)
    brakeBand.connect(this.absGain)
    this.absGain.connect(this.brakeGain)
    this.brakeGain.connect(this.master)
    this.squealBus = ctx.createGain()
    this.absDepth.connect(this.squealBus.gain)
    this.squealBus.connect(this.master)

    // BGM: <audio> を後でつなぐ（帯域で絞らない・雑音を混ぜない。S6）
    this.musicGain = this.silentGain()
    this.musicGain.connect(this.master)

    for (const node of [this.engineOsc, this.engineSub, this.absLfo]) node.start()
    this.sources.push(this.engineOsc, this.engineSub, this.absLfo, brakeNoise)
  }

  resume(): Promise<void> {
    return this.ctx.resume()
  }

  suspend(): Promise<void> {
    return this.ctx.suspend()
  }

  currentTime(): number {
    return this.ctx.currentTime
  }

  setLevels(l: AudioLevels): void {
    const at = this.ctx.currentTime
    this.engineOsc.frequency.setTargetAtTime(l.engineFreqHz, at, SMOOTH_S)
    this.engineSub.frequency.setTargetAtTime(l.engineFreqHz / 2, at, SMOOTH_S)
    this.engineFilter.frequency.setTargetAtTime(200 + l.engineFreqHz * 6, at, SMOOTH_S)
    this.engineGain.gain.setTargetAtTime(l.engine, at, SMOOTH_S)
    this.brakeGain.gain.setTargetAtTime(l.brakeNoise, at, SMOOTH_S)
    // ABS: 断続のあいだは 0.5 ± 0.5（0〜1）、効いていなければ 1 のまま
    const abs = l.absHz > 0
    if (abs) this.absLfo.frequency.setValueAtTime(l.absHz, at)
    this.absGain.gain.setValueAtTime(abs ? 0.5 : 1, at)
    this.squealBus.gain.setValueAtTime(abs ? 0.5 : 1, at)
    this.absDepth.gain.setValueAtTime(abs ? 0.5 : 0, at)
    const down = l.music < this.musicGain.gain.value
    this.musicGain.gain.setTargetAtTime(l.music, at, down ? MUSIC_DOWN_S : SMOOTH_S * 3)
  }

  setMusic(url: string | null): void {
    if (url === null) {
      if (this.media && !this.media.paused) this.media.pause()
      return
    }
    let media = this.media
    if (!media) {
      try {
        media = this.attachMedia()
      } catch {
        // <audio> を Web Audio につなげない（古い端末など）: BGM なし（S7）
        this.musicListener?.('blocked')
        return
      }
    }
    if (this.mediaUrl !== url) {
      media.src = url
      this.mediaUrl = url
    }
    if (media.paused) {
      // 拒まれた（NotAllowedError）ときだけ blocked。読み込み中の pause・src の差し替え（AbortError）は
      // 次の setMusic でやり直し、読めない曲（NotSupportedError）は <audio> の error で次の曲へ（code-reviewer C1）
      media.play().catch((e: unknown) => {
        // DOMException は環境によって Error を継がないので名前だけを見る
        const name = typeof e === 'object' && e !== null && 'name' in e ? e.name : null
        if (name === 'NotAllowedError') this.musicListener?.('blocked')
      })
    }
  }

  onMusicEvent(listener: (event: MusicEvent) => void): void {
    this.musicListener = listener
  }

  loadSamples(base: string): void {
    if (this.samplesRequested) return
    this.samplesRequested = true
    for (const [name, file] of Object.entries(SAMPLE_FILES) as [SampleName, string][]) {
      this.fetchBytes(`${base}${file}`)
        .then((bytes) => this.ctx.decodeAudioData(bytes))
        .then((buffer) => this.samples.set(name, buffer))
        // 読めなければその音だけ鳴らさない（S10）
        .catch(() => undefined)
    }
  }

  playSqueal(gain: number): void {
    this.playSample('squeal', gain, this.squealBus)
  }

  playCrash(gain: number): void {
    this.playSample('crash', gain, this.master)
    const at = this.ctx.currentTime + 0.01
    // 低いドスン: 下がる正弦波
    const osc = this.ctx.createOscillator()
    osc.frequency.setValueAtTime(THUD_FROM_HZ, at)
    osc.frequency.exponentialRampToValueAtTime(THUD_TO_HZ, at + THUD_S)
    const env = this.decay(at, THUD_S, gain * THUD_LEVEL)
    osc.connect(env)
    env.connect(this.master)
    this.playOnce(osc, env, at, THUD_S)
    // 低域の雑音の短い減衰
    const burst = this.ctx.createBufferSource()
    burst.buffer = this.noise
    const low = this.ctx.createBiquadFilter()
    low.type = 'lowpass'
    low.frequency.value = THUD_NOISE_HZ
    const burstEnv = this.decay(at, THUD_NOISE_S, gain * THUD_LEVEL)
    burst.connect(low)
    low.connect(burstEnv)
    burstEnv.connect(this.master)
    this.playOnce(burst, burstEnv, at, THUD_NOISE_S, low)
  }

  playNotify(gain: number, tones: number): void {
    const start = this.ctx.currentTime + 0.01
    for (const tone of NOTIFY_TONES.slice(0, tones)) {
      const osc = this.ctx.createOscillator()
      osc.frequency.value = tone.freqHz
      const env = this.envelope(start + tone.startS, tone.durS, gain)
      osc.connect(env)
      env.connect(this.master)
      this.playOnce(osc, env, start + tone.startS, tone.durS)
    }
  }

  close(): void {
    // 閉じた後の <audio> の出来事（src を外したときの error など）を知らせない（component-guard W3）
    this.musicListener = null
    for (const source of this.sources) {
      try {
        source.stop()
      } catch {
        // 既に止まっている
      }
    }
    if (this.media) {
      this.media.pause()
      this.media.removeAttribute('src')
      this.media.load()
      this.media = null
      this.mediaUrl = null
    }
    void this.ctx.close().catch(() => undefined)
  }

  private attachMedia(): HTMLAudioElement {
    const media = this.createMedia()
    media.preload = 'auto'
    media.addEventListener('ended', () => this.musicListener?.('ended'))
    media.addEventListener('error', () => this.musicListener?.('error'))
    const source = this.ctx.createMediaElementSource(media)
    source.connect(this.musicGain)
    this.media = media
    return media
  }

  private playSample(name: SampleName, gain: number, out: AudioNode): void {
    const buffer = this.samples.get(name)
    if (!buffer || gain <= 0) return
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    const env = this.ctx.createGain()
    env.gain.value = gain
    source.connect(env)
    env.connect(out)
    source.onended = () => {
      source.disconnect()
      env.disconnect()
    }
    source.start()
  }

  private silentGain(): GainNode {
    const gain = this.ctx.createGain()
    gain.gain.value = 0
    return gain
  }

  private loopNoise(): AudioBufferSourceNode {
    const source = this.ctx.createBufferSource()
    source.buffer = this.noise
    source.loop = true
    source.start()
    return source
  }

  /** 柔らかい立ち上がり（10 ms）と、止める前に 0 まで下がる減衰の包絡（止めるときにぷつっと鳴らない） */
  private envelope(atS: number, durS: number, peak: number): GainNode {
    const env = this.ctx.createGain()
    env.gain.setValueAtTime(0, atS)
    env.gain.linearRampToValueAtTime(peak, atS + 0.01)
    env.gain.setValueAtTime(peak, atS + Math.max(0.01, durS * 0.6))
    env.gain.linearRampToValueAtTime(0, atS + durS + RELEASE_S)
    return env
  }

  /** すぐ立ち上がって durS で消える減衰（衝突のドスン） */
  private decay(atS: number, durS: number, peak: number): GainNode {
    const env = this.ctx.createGain()
    env.gain.setValueAtTime(0, atS)
    env.gain.linearRampToValueAtTime(peak, atS + 0.005)
    env.gain.exponentialRampToValueAtTime(0.001, atS + durS)
    return env
  }

  private playOnce(
    source: AudioScheduledSourceNode,
    env: GainNode,
    atS: number,
    durS: number,
    ...between: AudioNode[]
  ): void {
    source.start(atS)
    source.stop(atS + durS + STOP_AFTER_S)
    source.onended = () => {
      source.disconnect()
      for (const node of between) node.disconnect()
      env.disconnect()
    }
  }
}
