// 運転の音（エンジン・ブレーキ・BGM・会話の通知音）を鳴らすか（docs/specs/drive-audio-chat/functional.md R1）。
// 鹿の警告の音（VITE_ALERT_SOUND、domain/silent-audio.ts）と同じ形: 開発中は既定で無音、本番は鳴らす。
// 鳴らして確かめたいときは VITE_GAME_AUDIO=on。

/** 運転の音を鳴らすか。本番は常に true。開発は VITE_GAME_AUDIO=on のときだけ true */
export function gameAudioEnabled(env: {
  DEV: boolean
  VITE_GAME_AUDIO?: string | undefined
}): boolean {
  return !env.DEV || env.VITE_GAME_AUDIO === 'on'
}
