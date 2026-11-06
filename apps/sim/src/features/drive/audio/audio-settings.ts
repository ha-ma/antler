import { DEFAULT_AUDIO_SETTINGS, type AudioSettings } from './mix'

// ## State設計（運転の音の設定。docs/specs/drive-audio-chat/functional.md R6・R14）
// - Shared state（この store）: 全体の音量・消音・BGM の ON/OFF。AudioControls（操作）と DriveAudio（鳴らす）が共有する。
//   画面（走行）ごとに作り、テストでは storage を差し替えるので、モジュールに 1 つの Zustand の store ではなく
//   subscribe / getSnapshot を持つ小さなクラスにした（DriveEngine と同じ形。React からは useSyncExternalStore で読む）。
// - 永続化: 端末の localStorage（`antler.drive.audio`）。読めない・壊れた値は既定値、書けなければ覚えないだけ。
// - Server state: なし（サーバーに送らない）。

export const SETTINGS_KEY = 'antler.drive.audio'

export type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>

const roundVolume = (v: number) => Math.min(100, Math.max(0, Math.round(v / 10) * 10))

export function parseAudioSettings(raw: string | null): AudioSettings {
  if (raw === null) return DEFAULT_AUDIO_SETTINGS
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return DEFAULT_AUDIO_SETTINGS
  }
  if (typeof value !== 'object' || value === null) return DEFAULT_AUDIO_SETTINGS
  const v = value as Record<string, unknown>
  return {
    volume:
      typeof v.volume === 'number' && Number.isFinite(v.volume)
        ? roundVolume(v.volume)
        : DEFAULT_AUDIO_SETTINGS.volume,
    muted: typeof v.muted === 'boolean' ? v.muted : DEFAULT_AUDIO_SETTINGS.muted,
    music: typeof v.music === 'boolean' ? v.music : DEFAULT_AUDIO_SETTINGS.music,
  }
}

/** 端末の localStorage（無い環境・拒否されたときは null） */
export function browserSettingsStorage(): SettingsStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export class AudioSettingsStore {
  private settings: AudioSettings
  private readonly listeners = new Set<() => void>()

  constructor(private readonly storage: SettingsStorage | null) {
    let raw: string | null = null
    try {
      raw = storage?.getItem(SETTINGS_KEY) ?? null
    } catch {
      raw = null
    }
    this.settings = parseAudioSettings(raw)
  }

  getSnapshot = (): AudioSettings => this.settings

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setVolume(volume: number): void {
    this.set({ ...this.settings, volume: roundVolume(volume) })
  }

  toggleMuted(): void {
    this.set({ ...this.settings, muted: !this.settings.muted })
  }

  toggleMusic(): void {
    this.set({ ...this.settings, music: !this.settings.music })
  }

  private set(next: AudioSettings): void {
    this.settings = next
    try {
      this.storage?.setItem(SETTINGS_KEY, JSON.stringify(next))
    } catch {
      // 書けなければ覚えないだけ（resilience.md）
    }
    for (const listener of this.listeners) listener()
  }
}
