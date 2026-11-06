// 会話の通知音（docs/specs/drive-audio-chat/functional.md R8）。自作の 2 音（C6 → F6）。
// 実在のサービスの通知音はまねない。2 秒以内に続けては鳴らさない。

export type Tone = { freqHz: number; startS: number; durS: number }

export const NOTIFY_TONES: readonly Tone[] = [
  { freqHz: 1046.5, startS: 0, durS: 0.06 },
  { freqHz: 1396.91, startS: 0.1, durS: 0.09 },
]

export const NOTIFY_MIN_INTERVAL_MS = 2000

/** 続けて鳴らさないための門（時刻は ms） */
export class NotifyGate {
  private lastMs: number | null = null

  allow(nowMs: number): boolean {
    if (this.lastMs !== null && nowMs - this.lastMs < NOTIFY_MIN_INTERVAL_MS) return false
    this.lastMs = nowMs
    return true
  }

  reset(): void {
    this.lastMs = null
  }
}
