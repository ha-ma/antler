import type { AudioPort } from '@antler/alert-ui'

// 開発中（npm run dev）はアラートの音を出さない（2026-11-03 ユーザーの依頼。内蔵ブラウザで画面を確かめるたびに
// チャイム・ビープ・読み上げが開発者に聞こえてしまうため）。鳴らして確かめたいときは VITE_ALERT_SOUND=on。
// 本番ビルドでは常に鳴らす（安全のための通知なので、ビルドの設定で消せないようにする）。

/** 何も鳴らさない出力先。解除は成功扱いにして、画面の流れ（B-0 の音の確認など）は本番と同じに進める。 */
export class SilentAudioPort implements AudioPort {
  unlock(): Promise<void> {
    return Promise.resolve()
  }
  playChime(): void {}
  playBeep(): void {}
  speak(): void {}
  cancelSpeech(): void {}
}

/** 音を鳴らすか。本番は常に true。開発は VITE_ALERT_SOUND=on のときだけ true。 */
export function alertSoundEnabled(env: {
  DEV: boolean
  VITE_ALERT_SOUND?: string | undefined
}): boolean {
  return !env.DEV || env.VITE_ALERT_SOUND === 'on'
}
