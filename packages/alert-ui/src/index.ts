// @antler/alert-ui — A の車内スマホと B の PWA が共有する 3 状態アラート。
// 仕様: docs/specs/alert-ui/、docs/design/AlertState.md。公開 API はこのファイルの export（凍結対象）。
// CSS 変数は `import '@antler/alert-ui/tokens.css'` を消費側のエントリで 1 回読み込む。
export { AlertState, type AlertStateProps } from './components/AlertState'
export { DeerPictogram } from './components/DeerPictogram'
export { BLINK_HALF_PERIOD_MS } from './components/use-blink'
export {
  deriveAlertState,
  FLAG_FRESH_MS,
  type AlertInputs,
  type DerivedAlert,
  type GpsZone,
} from './state/derive-alert-state'
export {
  AlertSoundController,
  beepIntervalMs,
  ZONE_REARM_MS,
  type AudioPort,
  type SoundControllerOptions,
  type SoundErrorEvent,
  type SoundUpdate,
} from './sound/sound-controller'
export { AlertSoundContext } from './sound/sound-context'
export {
  browserAudioDeps,
  WebAudioPort,
  type SoundUrls,
  type WebAudioDeps,
} from './sound/web-audio-port'
export { SOUND_URLS } from './sound/sound-urls'
export { formatKm, formatM } from './format/format'
export {
  ALERT_TEXT,
  LANGS,
  otherLangs,
  resolveLang,
  type AlertStateName,
  type Lang,
} from './i18n/i18n'
export { tokens, type ThemeId } from './tokens/tokens'
