import { AlertSoundController, SOUND_URLS, WebAudioPort, type AudioPort } from '@antler/alert-ui'
import { useCallback, useEffect, useState } from 'react'
import { logger } from '@/shared/utils/logger'
import { alertSoundEnabled, SilentAudioPort } from '../domain/silent-audio'

// 音のコントローラ（R7）。「出発」と「同じシードでもう一度」のボタンの操作の中で作り直して unlock() を呼ぶ
// （前の走行のゾーンの記憶でチャイムが抑えられない。spec-adversary M-2）。

export type AlertSound = {
  controller: AlertSoundController | null
  /** ボタンの操作の中で呼ぶ。新しいコントローラを作って unlock する */
  start: () => Promise<void>
}

// 開発中は既定で無音（VITE_ALERT_SOUND=on のときだけ鳴らす）。本番ビルドは常に鳴らす
const defaultPort = (): AudioPort =>
  alertSoundEnabled(import.meta.env) ? new WebAudioPort(SOUND_URLS) : new SilentAudioPort()

export function useAlertSound(createPort: () => AudioPort = defaultPort): AlertSound {
  const [controller, setController] = useState<AlertSoundController | null>(null)

  const start = useCallback(async () => {
    const next = new AlertSoundController(createPort(), {
      onError: (event) => logger.warn(event, { feature: 'drive' }),
    })
    // 前のコントローラは下の effect の片づけで止める
    setController(next)
    await next.unlock()
  }, [createPort])

  // 画面を離れたら止める（コントローラの寿命は外部資源なので effect で片づける）
  // eslint-disable-next-line no-restricted-syntax -- Web Audio のタイマーの片づけ（外部資源の寿命）
  useEffect(() => () => controller?.dispose(), [controller])

  return { controller, start }
}
