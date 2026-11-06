import type { DriveAudio } from '../audio/drive-audio'
import { driveAudioSignals } from '../audio/signals'
import type { DriveSnapshot, DriveTelemetry } from '../domain/engine'
import { advanceChat, chatFrameFromSnapshot, initialChatState } from './advance-chat'
import type { ChatFeedStore } from './chat-feed-store'
import type { ChatTrack } from './chat-types'

// 運転のスナップショットを、音（DriveAudio）と会話（advanceChat → ChatFeedStore）に流す（R9・R12）。
// DriveEngine.subscribe（約 10 Hz）で呼ばれる。React の描画とは別に動くので、フレームの重さに足さない。
// 音の合図（回転数・ブレーキの強さ・ABS）は DriveEngine.telemetry()（drive-tune R6）から読む。
// 会話が 1 行以上出たら通知音を 1 回（鳴らすかは DriveAudio が決める。R8）。

export type DriveSource = {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => DriveSnapshot
  telemetry: () => DriveTelemetry
}

export function linkDriveSoundAndChat(
  source: DriveSource,
  audio: DriveAudio,
  feed: ChatFeedStore,
  track: () => ChatTrack,
): () => void {
  let state = initialChatState()
  const onPublish = () => {
    const snapshot = source.getSnapshot()
    audio.update(driveAudioSignals(source.telemetry(), snapshot))
    const result = advanceChat(state, track(), chatFrameFromSnapshot(snapshot))
    state = result.state
    // restart なら表示も消す
    if (result.reset) feed.reset()
    if (result.emitted.length > 0) {
      feed.push(result.emitted)
      audio.notify()
    }
  }
  onPublish()
  return source.subscribe(onPublish)
}
