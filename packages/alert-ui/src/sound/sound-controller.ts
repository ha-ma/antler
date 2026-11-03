import { ALERT_TEXT, type AlertStateName, type Lang } from '../i18n/i18n'

// 3 状態の音（functional.md R5、ch5「音の仕様」）。状態の「変化」でだけ鳴らす（resilience.md IDEM-1）。
// 出力（Web Audio・speechSynthesis）は AudioPort として差し込む。テストは偽の AudioPort と偽の時計で確かめる。

/** 音を出す側。ブラウザでは WebAudioPort（web-audio-port.ts）。 */
export type AudioPort = {
  /** ユーザー操作の中で呼ぶ（ブラウザの自動再生の制限を解く）。失敗したら例外 */
  unlock(): Promise<void>
  playChime(): void
  playBeep(): void
  /** 読み上げ。使えなければ例外 */
  speak(lang: Lang, text: string): void
  cancelSpeech(): void
}

export type SoundUpdate = {
  state: AlertStateName
  /** danger のときの距離 m（ビープの間隔に使う） */
  distance: number | undefined
  lang: Lang
  muted: boolean
}

export type SoundErrorEvent = 'sound.failed' | 'tts.unavailable'

export type SoundControllerOptions = {
  onError?: (event: SoundErrorEvent, error: unknown) => void
}

/** ゾーンを出てからこの時間内に入り直したら、チャイムを鳴らさない（GPS の揺れ）。 */
export const ZONE_REARM_MS = 30_000

/**
 * ビープの間隔（ch5）: 距離が分からなければ 0.25 秒。120 m 以上で 0.4 秒、30 m 以下で 0.12 秒、その間は直線。
 */
export function beepIntervalMs(distanceM: number | undefined): number {
  if (distanceM === undefined || !Number.isFinite(distanceM) || distanceM < 0) return 250
  if (distanceM >= 120) return 400
  if (distanceM <= 30) return 120
  return 120 + ((distanceM - 30) / 90) * 280
}

export class AlertSoundController {
  private readonly port: AudioPort
  private readonly onError: SoundControllerOptions['onError']
  private unlocked = false
  private failed = false
  private unlocking: Promise<boolean> | null = null
  private current: SoundUpdate | null = null
  // ゾーン進入のチャイム
  private zoneAnnounced = false
  private leftZoneAt: number | null = null
  // danger のビープと読み上げ
  private timer: ReturnType<typeof setTimeout> | null = null
  private beeps = 0
  private spoken = false

  constructor(port: AudioPort, options: SoundControllerOptions = {}) {
    this.port = port
    this.onError = options.onError
  }

  /** 音が出せる状態か（解除済みで、再生に失敗していない）。 */
  get canPlay(): boolean {
    return this.unlocked && !this.failed
  }

  /** 音の解除。B-0 の「テスト音を鳴らして出発」などユーザー操作の中で呼ぶ。何度呼んでも出力側の解除は 1 回。 */
  unlock(): Promise<boolean> {
    if (this.unlocking) return this.unlocking
    this.unlocking = this.port.unlock().then(
      () => {
        this.unlocked = true
        if (this.current) this.applyDanger(this.current, this.current)
        return true
      },
      (error: unknown) => {
        this.unlocking = null
        this.fail(error)
        return false
      },
    )
    return this.unlocking
  }

  /** 描画のたびに呼んでよい。状態が変わったときだけ音が変わる。 */
  update(next: SoundUpdate): void {
    const prev = this.current
    this.current = next
    this.applyZone(next)
    this.applyDanger(prev, next)
  }

  dispose(): void {
    this.stopBeeps()
    this.current = null
  }

  private audible(u: SoundUpdate): boolean {
    return this.canPlay && !u.muted
  }

  private applyZone(u: SoundUpdate): void {
    const now = Date.now()
    if (u.state === 'safe') {
      if (this.zoneAnnounced) this.leftZoneAt = now
      this.zoneAnnounced = false
      return
    }
    if (u.state !== 'zone' || this.zoneAnnounced) return
    this.zoneAnnounced = true
    const rearmed = this.leftZoneAt === null || now - this.leftZoneAt > ZONE_REARM_MS
    if (rearmed && this.audible(u)) this.play(() => this.port.playChime())
  }

  private applyDanger(prev: SoundUpdate | null, next: SoundUpdate): void {
    if (next.state !== 'danger' || !this.audible(next)) {
      this.stopBeeps()
      return
    }
    if (prev?.state !== 'danger') {
      // 新しい danger。読み上げを数え直す
      this.beeps = 0
      this.spoken = false
    }
    if (this.timer === null) this.tick()
  }

  private tick = (): void => {
    this.timer = null
    const u = this.current
    if (!u || u.state !== 'danger' || !this.audible(u)) return
    if (!this.play(() => this.port.playBeep())) return
    this.beeps += 1
    if (this.beeps === 2 && !this.spoken) {
      this.spoken = true
      try {
        this.port.cancelSpeech()
        this.port.speak(u.lang, ALERT_TEXT[u.lang].speech)
      } catch (error) {
        this.onError?.('tts.unavailable', error)
      }
    }
    this.timer = setTimeout(this.tick, beepIntervalMs(this.current?.distance))
  }

  private stopBeeps(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  /** 再生の失敗は外に出さず、音を止めて canPlay=false に落とす（画面は止めない。FAIL-3）。 */
  private play(fn: () => void): boolean {
    try {
      fn()
      return true
    } catch (error) {
      this.fail(error)
      return false
    }
  }

  private fail(error: unknown): void {
    this.failed = true
    this.stopBeeps()
    this.onError?.('sound.failed', error)
  }
}
