import { useEffect, useMemo, useState } from 'react'
import type { AudioSettingsStore } from '../audio/audio-settings'
import type { DriveAudio } from '../audio/drive-audio'
import { useDriveAudio } from '../audio/use-drive-audio'
import type { DriveEngine } from '../domain/engine'
import { ChatFeedStore } from './chat-feed-store'
import type { ChatTrack } from './chat-types'
import { linkDriveSoundAndChat } from './link-drive'
import { useChatTrack, type RouteInfo } from './use-chat-track'

// 運転画面に音と会話をつなぐ（docs/specs/drive-audio-chat/functional.md R1〜R19）。DrivePage から 1 回呼ぶ。
// - 音（DriveAudio と音量の設定）と会話の表示の store を画面（エンジン）ごとに作る
// - 会話の束（api か見本）を道のりに写し、DriveEngine.subscribe（約 10 Hz）で音と会話を進める
// - 鳴らし始めは「出発」「もう一度」の操作の中で audio.start() を呼ぶ（呼ぶのは DrivePage）

export type DriveSoundAndChat = {
  audio: DriveAudio
  settings: AudioSettingsStore
  feed: ChatFeedStore
}

export function useDriveSoundAndChat(engine: DriveEngine): DriveSoundAndChat {
  const { scenario, plan } = engine.world
  const { audio, settings } = useDriveAudio(scenario.seed)
  const [feed] = useState(() => new ChatFeedStore())
  const route = useMemo<RouteInfo>(
    () => ({
      totalM: plan.totalKm * 1000,
      zonesKm: plan.intervals.map((i) => [i.entryKm, i.exitKm] as const),
    }),
    [plan],
  )
  const track = useChatTrack(scenario, route)
  // 束が途中で替わっても（見本 → api）購読をやり直さない（会話の進み具合を保つ）。いまの束は入れ物から読む
  const [current] = useState<{ track: ChatTrack }>(() => ({ track }))

  // eslint-disable-next-line no-restricted-syntax -- 購読の外（DriveEngine の listener）へ、いまの束を渡す
  useEffect(() => {
    current.track = track
  }, [current, track])

  // eslint-disable-next-line no-restricted-syntax -- DriveEngine の購読（外部の購読。片づけで止める）
  useEffect(
    () => linkDriveSoundAndChat(engine, audio, feed, () => current.track),
    [engine, audio, feed, current],
  )

  return { audio, settings, feed }
}
