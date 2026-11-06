import { brakeVoice } from './brake-voice'
import { engineVoice } from './engine-voice'
import type { DriveAudioSignals } from './signals'

// 音量の混ぜ方（docs/specs/drive-audio-chat/functional.md R6、drive-sound-tourism S5・S8・S11・S12）。純粋関数。
// 利用者の設定（音量・消音・BGM）と、鹿の警告の状態による自動の下げを掛け合わせる。
// 鹿の警告の音（alert-ui）はここを通らない（消音でも消えない）。

export type AudioSettings = {
  /** 全体の音量（0〜100、10 きざみ） */
  volume: number
  muted: boolean
  /** BGM（車内の音楽）を流すか */
  music: boolean
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = { volume: 60, muted: false, music: true }

/** 部品ごとの係数 */
const ENGINE_LEVEL = 0.5
const BRAKE_LEVEL = 1
const MUSIC_LEVEL = 0.3
const NOTIFY_LEVEL = 0.5
const CRASH_LEVEL = 1
/** 赤の間にエンジン・ブレーキに掛ける倍率（警告のビープと読み上げを聞こえやすく） */
const DANGER_DUCK = 0.5
/** 琥珀の間に BGM と通知音に掛ける倍率 */
const ZONE_DUCK = 0.6

/** 実際に鳴らす大きさ（0〜1） */
export type AudioLevels = {
  engine: number
  engineFreqHz: number
  brakeNoise: number
  /** 鳴きの録音の大きさ。0 なら鳴らさない（S9） */
  brakeSqueal: number
  absHz: number
  /** BGM の大きさ（赤で 0。曲は止めない） */
  music: number
  /** 曲を流すか（消音・BGM OFF・音量 0・走行の終わりで止める。赤・一時停止は流したまま。S5） */
  musicOn: boolean
  /** 通知音の大きさ。0 なら鳴らさない */
  notify: number
  /** 通知音の音の数（緑 2・琥珀 1。ゾーンのチャイムと聞き分ける。S11） */
  notifyTones: 1 | 2
  /** 衝突の音の大きさ。0 なら鳴らさない（S12） */
  crash: number
}

function musicDuck(s: DriveAudioSignals): number {
  if (s.outcome !== 'driving' || s.alert === 'danger') return 0
  // アラート OFF の走行では、ゾーンを音で知らせない（R6a）
  return s.alert === 'zone' && s.alertEnabled ? ZONE_DUCK : 1
}

/** 通知音の倍率（S11: 緑 1・琥珀 0.6・赤 0。アラート OFF は赤以外 1） */
function notifyDuck(s: DriveAudioSignals): number {
  if (s.alert === 'danger') return 0
  return s.alert === 'zone' && s.alertEnabled ? ZONE_DUCK : 1
}

export function mixLevels(s: DriveAudioSignals, settings: AudioSettings): AudioLevels {
  const engine = engineVoice(s)
  const brake = brakeVoice(s)
  const master = settings.muted ? 0 : Math.min(100, Math.max(0, settings.volume)) / 100
  const physical = s.alert === 'danger' ? DANGER_DUCK : 1
  const musicOn = settings.music && master > 0 && s.outcome === 'driving'
  return {
    engine: engine.gain * master * ENGINE_LEVEL * physical,
    engineFreqHz: engine.freqHz,
    brakeNoise: brake.noise * master * BRAKE_LEVEL * physical,
    brakeSqueal: brake.squeal * master * BRAKE_LEVEL * physical,
    absHz: brake.absHz,
    music: musicOn ? master * MUSIC_LEVEL * musicDuck(s) : 0,
    musicOn,
    notify: master * NOTIFY_LEVEL * notifyDuck(s),
    notifyTones: s.alert === 'zone' && s.alertEnabled ? 1 : 2,
    crash: master * CRASH_LEVEL,
  }
}
