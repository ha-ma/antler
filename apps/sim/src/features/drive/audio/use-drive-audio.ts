import { useEffect, useState } from 'react'
import { logger } from '@/shared/utils/logger'
import { gameAudioEnabled } from './audio-env'
import { WebAudioGraph, type AudioGraphPort } from './audio-graph'
import { AudioSettingsStore, browserSettingsStorage } from './audio-settings'
import { DriveAudio } from './drive-audio'

// 運転の音の持ち手（docs/specs/drive-audio-chat/functional.md R1・R7）。
// - DriveAudio と設定の store を画面ごとに 1 つ作る。鳴らし始めは「出発」の操作の中の audio.start()（呼ぶのは組み込み側）
// - タブを隠したら止め、画面を離れたら閉じる（外部資源の寿命なので effect で片づける）
// - seed と createGraph は最初の描画の値で決まる。場面（seed）が替わるなら、組み込み側で key={scenario.seed} を付けて作り直す

/** 鳴らさない設定（R1）なら音のグラフを作らない */
export function defaultCreateGraph(): AudioGraphPort | null {
  return gameAudioEnabled(import.meta.env) ? new WebAudioGraph() : null
}

export type DriveAudioHandle = { audio: DriveAudio; settings: AudioSettingsStore }

export function useDriveAudio(
  seed: number,
  createGraph: () => AudioGraphPort | null = defaultCreateGraph,
): DriveAudioHandle {
  const [settings] = useState(() => new AudioSettingsStore(browserSettingsStorage()))
  const [audio] = useState(
    () =>
      new DriveAudio({
        createGraph,
        settings,
        seed,
        onError: (event) => logger.warn(event, { feature: 'drive' }),
      }),
  )

  // eslint-disable-next-line no-restricted-syntax -- document の visibilitychange の購読と、Web Audio の片づけ（外部資源の寿命）
  useEffect(() => {
    const onVisibility = () => audio.setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      audio.dispose()
    }
  }, [audio])

  return { audio, settings }
}
