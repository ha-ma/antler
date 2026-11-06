import type { DriveAudio } from '../audio/drive-audio'
import { signalsFromSnapshot } from '../audio/signals'
import type { DriveSnapshot } from '../domain/engine'
import type { DriveInput } from '../types'
import { advanceChat, chatFrameFromSnapshot, initialChatState } from './advance-chat'
import type { ChatFeedStore } from './chat-feed-store'
import type { ChatTrack } from './chat-types'

// 運転のスナップショットを、音（DriveAudio）と会話（advanceChat → ChatFeedStore）に流す（R9・R12）。
// DriveEngine.subscribe（約 10 Hz）で呼ばれる。React の描画とは別に動くので、フレームの重さに足さない。
// 会話が 1 行以上出たら通知音を 1 回（鳴らすかは DriveAudio が決める。R8）。

export type DriveSource = {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => DriveSnapshot
  /** いまの入力（ブレーキ・アクセルの合図に使う） */
  readonly world: { readonly input: DriveInput }
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
    audio.update(signalsFromSnapshot(snapshot, source.world.input))
    const before = state
    const result = advanceChat(state, track(), chatFrameFromSnapshot(snapshot))
    state = result.state
    // restart（t が戻った）なら表示も消す
    if (state.lastT < before.lastT) feed.reset()
    if (result.emitted.length > 0) {
      feed.push(result.emitted)
      audio.notify()
    }
  }
  onPublish()
  return source.subscribe(onPublish)
}
