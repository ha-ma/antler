import type { AudioGraphPort, MusicEvent } from './audio-graph'
import type { AudioSettingsStore } from './audio-settings'
import { squealDue } from './brake-voice'
import { mixLevels, type AudioLevels } from './mix'
import { assetUrl, firstTrackIndex, MUSIC_TRACKS, nextTrackIndex } from './music-tracks'
import { NotifyGate, ZONE_CHIME_QUIET_MS } from './notify-tone'
import { IDLE_SIGNALS, type DriveAudioSignals } from './signals'

// 運転の音のコントローラ（docs/specs/drive-audio-chat/functional.md R1・R6〜R9、drive-sound-tourism S3〜S12）。
// - 音のグラフは「出発」のボタンの操作の中の start() で 1 つだけ作り、「もう一度」では resume だけ（AudioContext を増やさない）
// - 曲（<audio>）と短い音の読み込みも start() の中で始める（初回読込に足さない）。最初の曲は resume() を待つ前に
//   流し始める（iOS Safari は操作の外の再生を拒む。S3）
// - update() はスナップショット（約 10 Hz）ごとに呼ぶ。値が変わったときだけグラフに渡す
// - 失敗（作れない・resume を拒まれた・曲を流せない）は例外にせず無音で続ける（resilience.md FAIL-44、S7）

export type DriveAudioOptions = {
  /** 音のグラフを作る。鳴らさない設定（R1）なら null を返す */
  createGraph: () => AudioGraphPort | null
  settings: AudioSettingsStore
  /** BGM の最初の曲の種（DriveScenario.seed） */
  seed: number
  /** 音源の URL の前に付ける（Vite の BASE_URL） */
  assetBase?: string
  /** 実時間（ms）。通知音の間隔（R8・S11）に使う */
  nowMs?: () => number
  onError?: (event: string) => void
}

const GAIN_EPS = 0.001
const FREQ_EPS_HZ = 0.25

function changed(a: AudioLevels, b: AudioLevels): boolean {
  return (
    Math.abs(a.engine - b.engine) > GAIN_EPS ||
    Math.abs(a.engineFreqHz - b.engineFreqHz) > FREQ_EPS_HZ ||
    Math.abs(a.brakeNoise - b.brakeNoise) > GAIN_EPS ||
    Math.abs(a.music - b.music) > GAIN_EPS ||
    a.absHz !== b.absHz
  )
}

// ## State設計（運転の音。drive-audio-chat R7〜R9、drive-sound-tourism S3〜S12）
// - Shared state（このクラス。React の外）: グラフ・走っているか・隠したか・最後の合図と渡した大きさ
// - 曲: いまの曲の番号（シードで決め、終われば次）。拒まれた（次の操作まで）・続けて読めなかった数（3 で
//   あきらめる）・記録したか（画面で 1 回）。拒まれたは start と設定の変更で、読めなかった数は曲が終わったときに戻す
// - 1 回の走行の記録: 最後の鳴きの時刻・衝突音を鳴らしたか。start（出発・もう一度）で戻す
// - 緑からゾーンに入った時刻（通知音をチャイムと重ねない）。琥珀でなくなったら戻す
// - 派生値: 大きさ（mixLevels）
export class DriveAudio {
  private graph: AudioGraphPort | null = null
  private running = false
  private hidden = false
  private signals: DriveAudioSignals = IDLE_SIGNALS
  private applied: AudioLevels | null = null
  private track: number
  /** 再生を拒まれた。次の利用者の操作（start・設定の変更）までやり直さない（S7） */
  private musicBlocked = false
  /** 続けて読めなかった曲の数。曲の数に達したらその画面ではあきらめる（S7） */
  private musicErrors = 0
  private musicLogged = false
  private squealAtS: number | null = null
  private crashed = false
  /** 緑からゾーンに入った実時間（ms）。チャイムと重ねない（S11） */
  private zoneEnteredMs: number | null = null
  private readonly gate = new NotifyGate()
  private unsubscribe: (() => void) | null = null
  private readonly nowMs: () => number
  private readonly assetBase: string

  constructor(private readonly opts: DriveAudioOptions) {
    this.track = firstTrackIndex(opts.seed)
    this.nowMs = opts.nowMs ?? (() => performance.now())
    this.assetBase = opts.assetBase ?? '/'
  }

  /**
   * ボタンの操作の中で呼ぶ。鳴らせれば true。
   * dispose の後に呼べば作り直す（React の StrictMode で effect の片づけが先に走っても、次の操作で鳴らせる）
   */
  async start(): Promise<boolean> {
    // 音量・消音・BGM の操作は利用者の操作なので、拒まれた曲もやり直す（S7）。最後の合図で値を渡し直す
    this.unsubscribe ??= this.opts.settings.subscribe(() => {
      this.musicBlocked = false
      this.apply()
    })
    try {
      if (!this.graph) {
        const graph = this.opts.createGraph()
        if (!graph) return false
        graph.onMusicEvent((event) => this.onMusic(event))
        graph.loadSamples(this.assetBase)
        this.graph = graph
      }
      const graph = this.graph
      this.musicBlocked = false
      // 曲はボタンの操作の中（await の前）で流し始める（S3）
      this.syncMusic(graph, this.current())
      await graph.resume()
      this.running = true
      // 値は渡し直す。「もう一度」で衝突の音・通知の間隔・鳴きを数え直す（S12）
      this.applied = null
      this.squealAtS = null
      this.crashed = false
      this.gate.reset()
      this.apply()
      return true
    } catch {
      this.running = false
      this.graph?.setMusic(null)
      this.opts.onError?.('drive.audio.start_failed')
      return false
    }
  }

  update(signals: DriveAudioSignals): void {
    if (signals.alert === 'zone' && this.signals.alert === 'safe') this.zoneEnteredMs = this.nowMs()
    else if (signals.alert !== 'zone') this.zoneEnteredMs = null
    this.signals = signals
    this.apply()
  }

  /** 会話が出たときに呼ぶ。鳴らしたら true（R8・S11） */
  notify(): boolean {
    if (!this.graph || !this.running) return false
    const levels = this.current()
    if (levels.notify <= 0) return false
    const now = this.nowMs()
    // ゾーンに入って 2 秒はチャイム（alert-ui）と重ねない（S11）
    const chime =
      this.signals.alertEnabled &&
      this.zoneEnteredMs !== null &&
      now - this.zoneEnteredMs < ZONE_CHIME_QUIET_MS
    if (chime) return false
    if (!this.gate.allow(now)) return false
    this.graph.playNotify(levels.notify, levels.notifyTones)
    return true
  }

  /** 鹿にぶつかったときに呼ぶ（S12）。1 回の走行で 1 回。鳴らしたら true */
  crash(): boolean {
    if (!this.graph || !this.running || this.crashed) return false
    const levels = this.current()
    if (levels.crash <= 0) return false
    this.crashed = true
    this.graph.playCrash(levels.crash)
    return true
  }

  /** タブを隠したら止め、戻したら再開する（R7・S5） */
  setHidden(hidden: boolean): void {
    this.hidden = hidden
    if (!this.graph || !this.running) return
    const graph = this.graph
    if (hidden) graph.setMusic(null)
    const done = hidden ? graph.suspend() : graph.resume()
    done.catch(() => this.opts.onError?.('drive.audio.visibility_failed'))
    if (!hidden) this.apply()
  }

  /** 画面を離れたら閉じる（AudioContext を close・曲を外す。R1） */
  dispose(): void {
    this.running = false
    this.unsubscribe?.()
    this.unsubscribe = null
    this.graph?.close()
    this.graph = null
  }

  private current(): AudioLevels {
    return mixLevels(this.signals, this.opts.settings.getSnapshot())
  }

  private apply(): void {
    const graph = this.graph
    if (!graph || !this.running) return
    const levels = this.current()
    if (!this.applied || changed(this.applied, levels)) {
      graph.setLevels(levels)
      this.applied = levels
    }
    this.syncMusic(graph, levels)
    // 鳴き（S9）: 条件の間は録音の長さごとに鳴らし直す。外れたら次は踏み直しからすぐ
    const now = graph.currentTime()
    if (levels.brakeSqueal <= 0) this.squealAtS = null
    else if (squealDue(levels.brakeSqueal, this.squealAtS, now)) {
      graph.playSqueal(levels.brakeSqueal)
      this.squealAtS = now
    }
  }

  /** 曲を流すか止めるか（S5）。赤は大きさ 0 で流したまま */
  private syncMusic(graph: AudioGraphPort, levels: AudioLevels): void {
    const gaveUp = this.musicErrors >= MUSIC_TRACKS.length
    const on = levels.musicOn && !this.hidden && !this.musicBlocked && !gaveUp
    const track = MUSIC_TRACKS[this.track]
    graph.setMusic(on && track ? assetUrl(track.file, this.assetBase) : null)
  }

  private logMusicFailure(): void {
    if (this.musicLogged) return
    this.musicLogged = true
    this.opts.onError?.('drive.audio.music_failed')
  }

  private onMusic(event: MusicEvent): void {
    const graph = this.graph
    if (!graph) return
    if (event === 'blocked') {
      // 再生を拒まれた: BGM なしで続け、次の利用者の操作でやり直す（S7）
      this.musicBlocked = true
      this.logMusicFailure()
      return
    }
    if (event === 'error') {
      this.musicErrors += 1
      if (this.musicErrors >= MUSIC_TRACKS.length) {
        this.logMusicFailure()
        graph.setMusic(null)
        return
      }
    } else {
      this.musicErrors = 0
    }
    // 終わった・読めなかった → 次の曲（S4）
    this.track = nextTrackIndex(this.track)
    if (this.running) this.syncMusic(graph, this.current())
  }
}
