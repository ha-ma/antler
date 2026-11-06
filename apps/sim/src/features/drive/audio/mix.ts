import { brakeVoice } from './brake-voice'
import { engineVoice } from './engine-voice'
import type { DriveAudioSignals } from './signals'

// 音量の混ぜ方（docs/specs/drive-audio-chat/functional.md R6）。純粋関数。
// 利用者の設定（音量・消音・BGM）と、鹿の警告の状態による自動の下げを掛け合わせる。
// 鹿の警告の音（alert-ui）はここを通らない（消音でも消えない）。

export type AudioSettings = {
  /** 全体の音量（0〜100、10 きざみ） */
  volume: number
  muted: boolean
  /** BGM（車内のラジオ）を流すか */
  music: boolean
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = { volume: 60, muted: false, music: true }

/** 部品ごとの係数 */
const ENGINE_LEVEL = 0.5
const BRAKE_LEVEL = 0.6
const MUSIC_LEVEL = 0.18
const NOTIFY_LEVEL = 0.5
/** 赤の間にエンジン・ブレーキに掛ける倍率（警告のビープと読み上げを聞こえやすく） */
const DANGER_DUCK = 0.5
/** 琥珀の間に BGM に掛ける倍率 */
const ZONE_MUSIC_DUCK = 0.6

/** 実際に鳴らす大きさ（0〜1） */
export type AudioLevels = {
  engine: number
  engineFreqHz: number
  brakeNoise: number
  brakeSqueal: number
  absHz: number
  music: number
  /** 通知音の大きさ。0 なら鳴らさない */
  notify: number
}

function musicDuck(s: DriveAudioSignals): number {
  if (s.outcome !== 'driving' || s.alert === 'danger') return 0
  // アラート OFF の走行では、ゾーンを音で知らせない（R6a）
  return s.alert === 'zone' && s.alertEnabled ? ZONE_MUSIC_DUCK : 1
}

/** 通知音を鳴らせる状態か（R8: 緑のときだけ。アラート OFF は赤以外ならゾーンでも鳴る） */
function notifyAllowed(s: DriveAudioSignals): boolean {
  if (s.alert === 'danger') return false
  return s.alert === 'safe' || !s.alertEnabled
}

export function mixLevels(s: DriveAudioSignals, settings: AudioSettings): AudioLevels {
  const engine = engineVoice(s)
  const brake = brakeVoice(s)
  const master = settings.muted ? 0 : Math.min(100, Math.max(0, settings.volume)) / 100
  const physical = s.alert === 'danger' ? DANGER_DUCK : 1
  return {
    engine: engine.gain * master * ENGINE_LEVEL * physical,
    engineFreqHz: engine.freqHz,
    brakeNoise: brake.noise * master * BRAKE_LEVEL * physical,
    brakeSqueal: brake.squeal * master * BRAKE_LEVEL * physical,
    absHz: brake.absHz,
    music: settings.music ? master * MUSIC_LEVEL * musicDuck(s) : 0,
    notify: notifyAllowed(s) ? master * NOTIFY_LEVEL : 0,
  }
}
