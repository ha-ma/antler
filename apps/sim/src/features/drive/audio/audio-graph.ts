import type { AudioLevels } from './mix'
import { NOTIFY_TONES } from './notify-tone'
import type { Voice } from './radio-score'

// Web Audio の音のグラフ（docs/specs/drive-audio-chat/functional.md R2〜R5・R8・R9）。音はすべてここで合成する（音声ファイルを使わない）。
// 何をどの大きさで鳴らすかは mix.ts・radio-score.ts の純粋関数が決め、ここは値を AudioParam に渡すだけにする。
// ノードは作り直さず（音符と通知音の短いノードだけ作って終わったら外す）、値は setTargetAtTime でならす。

export type ScheduledNote = {
  /** AudioContext の時刻（秒） */
  atS: number
  durS: number
  freqHz: number
  voice: Voice
}

/** 音の差し込み口（テストではフェイク） */
export interface AudioGraphPort {
  resume(): Promise<void>
  suspend(): Promise<void>
  /** AudioContext の時刻（秒） */
  currentTime(): number
  setLevels(levels: AudioLevels): void
  scheduleNotes(notes: readonly ScheduledNote[]): void
  playNotify(gain: number): void
  close(): void
}

/** 値の変化をならす時定数（秒）。0.1 秒程度で目標に近づく */
const SMOOTH_S = 0.03
/** 赤で BGM を下げるときの時定数（0.15 秒以内に下げる） */
const MUSIC_DOWN_S = 0.04
const NOISE_SECONDS = 2
const SQUEAL_HZ = 1800
const BRAKE_BAND_HZ = 2400
const RADIO_LOW_HZ = 300
const RADIO_HIGH_HZ = 3000
const HISS_LEVEL = 0.06
const VOICE_LEVEL: Record<Voice, number> = { bass: 0.5, pad: 0.16, lead: 0.22 }
/** 音符の終わりから 0 まで下げる時間（秒）。止めるのはその少し後 */
const RELEASE_S = 0.2
const STOP_AFTER_S = 0.3
const VOICE_WAVE: Record<Voice, OscillatorType> = {
  bass: 'triangle',
  pad: 'sine',
  lead: 'triangle',
}

/** 種 1 の白色雑音（Math.random を使わない。同じ音） */
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * NOISE_SECONDS)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  let x = 1
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) % 2147483648
    data[i] = (x / 1073741824 - 1) * 0.9
  }
  return buffer
}

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
  private readonly squealGain: GainNode
  private readonly musicIn: BiquadFilterNode
  private readonly musicGain: GainNode
  private readonly sources: AudioScheduledSourceNode[] = []

  constructor(createContext: () => AudioContext = () => new AudioContext()) {
    const ctx = createContext()
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.connect(ctx.destination)
    const noise = noiseBuffer(ctx)

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

    // ブレーキ: 雑音を帯域で絞り、ABS の断続（14 Hz の矩形の LFO）を掛ける
    const brakeNoise = this.loopNoise(noise)
    const brakeBand = ctx.createBiquadFilter()
    brakeBand.type = 'bandpass'
    brakeBand.frequency.value = BRAKE_BAND_HZ
    brakeBand.Q.value = 0.8
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

    const squeal = ctx.createOscillator()
    squeal.frequency.value = SQUEAL_HZ
    this.squealGain = this.silentGain()
    squeal.connect(this.squealGain)
    this.squealGain.connect(this.master)

    // ラジオ: 300〜3,000 Hz に絞り、小さな雑音を混ぜる
    this.musicIn = ctx.createBiquadFilter()
    this.musicIn.type = 'highpass'
    this.musicIn.frequency.value = RADIO_LOW_HZ
    const radioTop = ctx.createBiquadFilter()
    radioTop.type = 'lowpass'
    radioTop.frequency.value = RADIO_HIGH_HZ
    this.musicGain = this.silentGain()
    const hiss = this.loopNoise(noise)
    const hissGain = ctx.createGain()
    hissGain.gain.value = HISS_LEVEL
    hiss.connect(hissGain)
    hissGain.connect(radioTop)
    this.musicIn.connect(radioTop)
    radioTop.connect(this.musicGain)
    this.musicGain.connect(this.master)

    for (const node of [this.engineOsc, this.engineSub, this.absLfo, squeal]) node.start()
    this.sources.push(this.engineOsc, this.engineSub, this.absLfo, squeal, brakeNoise, hiss)
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
    this.squealGain.gain.setTargetAtTime(l.brakeSqueal, at, SMOOTH_S)
    // ABS: 断続のあいだは 0.5 ± 0.5（0〜1）、効いていなければ 1 のまま
    const abs = l.absHz > 0
    if (abs) this.absLfo.frequency.setValueAtTime(l.absHz, at)
    this.absGain.gain.setValueAtTime(abs ? 0.5 : 1, at)
    this.absDepth.gain.setValueAtTime(abs ? 0.5 : 0, at)
    const down = l.music < this.musicGain.gain.value
    this.musicGain.gain.setTargetAtTime(l.music, at, down ? MUSIC_DOWN_S : SMOOTH_S * 3)
  }

  scheduleNotes(notes: readonly ScheduledNote[]): void {
    for (const note of notes) {
      const osc = this.ctx.createOscillator()
      osc.type = VOICE_WAVE[note.voice]
      osc.frequency.value = note.freqHz
      const env = this.envelope(note.atS, note.durS, VOICE_LEVEL[note.voice])
      osc.connect(env)
      env.connect(this.musicIn)
      this.playOnce(osc, env, note.atS, note.durS)
    }
  }

  playNotify(gain: number): void {
    const start = this.ctx.currentTime + 0.01
    for (const tone of NOTIFY_TONES) {
      const osc = this.ctx.createOscillator()
      osc.frequency.value = tone.freqHz
      const env = this.envelope(start + tone.startS, tone.durS, gain)
      osc.connect(env)
      env.connect(this.master)
      this.playOnce(osc, env, start + tone.startS, tone.durS)
    }
  }

  close(): void {
    for (const source of this.sources) {
      try {
        source.stop()
      } catch {
        // 既に止まっている
      }
    }
    void this.ctx.close().catch(() => undefined)
  }

  private silentGain(): GainNode {
    const gain = this.ctx.createGain()
    gain.gain.value = 0
    return gain
  }

  private loopNoise(buffer: AudioBuffer): AudioBufferSourceNode {
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
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

  private playOnce(osc: OscillatorNode, env: GainNode, atS: number, durS: number): void {
    osc.start(atS)
    osc.stop(atS + durS + STOP_AFTER_S)
    osc.onended = () => {
      osc.disconnect()
      env.disconnect()
    }
  }
}
