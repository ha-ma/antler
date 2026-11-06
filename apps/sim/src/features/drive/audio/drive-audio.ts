import type { AudioGraphPort, ScheduledNote } from './audio-graph'
import type { AudioSettingsStore } from './audio-settings'
import { mixLevels, type AudioLevels } from './mix'
import { NotifyGate } from './notify-tone'
import { BAR_BEATS, midiToHz, radioScore, type RadioScore } from './radio-score'
import { IDLE_SIGNALS, type DriveAudioSignals } from './signals'

// 運転の音のコントローラ（docs/specs/drive-audio-chat/functional.md R1・R6〜R9）。
// - 音のグラフは「出発」のボタンの操作の中の start() で 1 つだけ作り、「もう一度」では resume だけ（AudioContext を増やさない）
// - update() はスナップショット（約 10 Hz）ごとに呼ぶ。値が変わったときだけグラフに渡す
// - BGM は 1 小節先までを予約する（タイマーを持たず、update のたびに足りない小節を足す）
// - 失敗（作れない・resume を拒まれた）は例外にせず無音で続ける（resilience.md FAIL-44）

export type DriveAudioOptions = {
  /** 音のグラフを作る。鳴らさない設定（R1）なら null を返す */
  createGraph: () => AudioGraphPort | null
  settings: AudioSettingsStore
  /** BGM の曲の種（DriveScenario.seed） */
  seed: number
  /** 実時間（ms）。通知音の間隔（R8）に使う */
  nowMs?: () => number
  onError?: (event: string) => void
}

/** BGM を最初に鳴らすまでの余裕（秒） */
const MUSIC_LEAD_S = 0.1
const GAIN_EPS = 0.001
const FREQ_EPS_HZ = 0.25

function changed(a: AudioLevels, b: AudioLevels): boolean {
  return (
    Math.abs(a.engine - b.engine) > GAIN_EPS ||
    Math.abs(a.engineFreqHz - b.engineFreqHz) > FREQ_EPS_HZ ||
    Math.abs(a.brakeNoise - b.brakeNoise) > GAIN_EPS ||
    Math.abs(a.brakeSqueal - b.brakeSqueal) > GAIN_EPS ||
    Math.abs(a.music - b.music) > GAIN_EPS ||
    Math.abs(a.notify - b.notify) > GAIN_EPS ||
    a.absHz !== b.absHz
  )
}

export class DriveAudio {
  private graph: AudioGraphPort | null = null
  private running = false
  private signals: DriveAudioSignals = IDLE_SIGNALS
  private applied: AudioLevels | null = null
  private readonly score: RadioScore
  private nextBar = 0
  private nextBarAtS: number | null = null
  private readonly gate = new NotifyGate()
  private unsubscribe: (() => void) | null = null
  private readonly nowMs: () => number

  constructor(private readonly opts: DriveAudioOptions) {
    this.score = radioScore(opts.seed)
    this.nowMs = opts.nowMs ?? (() => performance.now())
  }

  /**
   * ボタンの操作の中で呼ぶ。鳴らせれば true。
   * dispose の後に呼べば作り直す（React の StrictMode で effect の片づけが先に走っても、次の操作で鳴らせる）
   */
  async start(): Promise<boolean> {
    // 音量・消音・BGM を変えたら、最後の合図で値を渡し直す
    this.unsubscribe ??= this.opts.settings.subscribe(() => this.apply())
    try {
      this.graph ??= this.opts.createGraph()
      if (!this.graph) return false
      await this.graph.resume()
      this.running = true
      this.applied = null
      this.nextBarAtS = null
      this.gate.reset()
      return true
    } catch {
      this.running = false
      this.opts.onError?.('drive.audio.start_failed')
      return false
    }
  }

  update(signals: DriveAudioSignals): void {
    this.signals = signals
    this.apply()
  }

  /** 会話が出たときに呼ぶ。鳴らしたら true（R8） */
  notify(): boolean {
    if (!this.graph || !this.running) return false
    const levels = this.applied ?? mixLevels(this.signals, this.opts.settings.getSnapshot())
    if (levels.notify <= 0) return false
    if (!this.gate.allow(this.nowMs())) return false
    this.graph.playNotify(levels.notify)
    return true
  }

  /** タブを隠したら止め、戻したら再開する（R7） */
  setHidden(hidden: boolean): void {
    if (!this.graph || !this.running) return
    const done = hidden ? this.graph.suspend() : this.graph.resume()
    done.catch(() => this.opts.onError?.('drive.audio.visibility_failed'))
  }

  /** 画面を離れたら閉じる（AudioContext を close。R1） */
  dispose(): void {
    this.running = false
    this.unsubscribe?.()
    this.unsubscribe = null
    this.graph?.close()
    this.graph = null
  }

  private apply(): void {
    const graph = this.graph
    if (!graph || !this.running) return
    const levels = mixLevels(this.signals, this.opts.settings.getSnapshot())
    if (!this.applied || changed(this.applied, levels)) {
      graph.setLevels(levels)
      this.applied = levels
    }
    this.scheduleMusic(graph)
  }

  private scheduleMusic(graph: AudioGraphPort): void {
    const now = graph.currentTime()
    const beatS = 60 / this.score.bpm
    const barS = BAR_BEATS * beatS
    // 初めて・止まっていた（予約が今より前で尽きた）なら今から始める
    if (this.nextBarAtS === null || this.nextBarAtS < now) this.nextBarAtS = now + MUSIC_LEAD_S
    while (this.nextBarAtS < now + barS) {
      const bar = this.score.bars[this.nextBar] ?? []
      const at = this.nextBarAtS
      graph.scheduleNotes(
        bar.map((n): ScheduledNote => ({
          atS: at + n.beat * beatS,
          durS: n.beats * beatS,
          freqHz: midiToHz(n.midi),
          voice: n.voice,
        })),
      )
      this.nextBar = (this.nextBar + 1) % this.score.bars.length
      this.nextBarAtS += barS
    }
  }
}
