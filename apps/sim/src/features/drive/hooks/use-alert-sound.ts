import { AlertSoundController, SOUND_URLS, WebAudioPort, type AudioPort } from '@antler/alert-ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { logger } from '@/shared/utils/logger'
import { alertSoundEnabled, SilentAudioPort } from '../domain/silent-audio'

// 音のコントローラ（R7）。「出発」と「同じシードでもう一度」のボタンの操作の中で作り直して unlock() を呼ぶ
// （前の走行のゾーンの記憶でチャイムが抑えられない。spec-adversary M-2）。
// ステージを移るときは、同じ出力先（解除済み）で作り直す（drive-tune R1。手前は 5 km だけなので、
// 16× で走ると alert-ui の ZONE_REARM_MS（30 秒）より早く次のゾーンに入り、チャイムが抑えられるため）。

export type AlertSound = {
  controller: AlertSoundController | null
  /** ボタンの操作の中で呼ぶ。新しい出力先とコントローラを作って unlock する */
  start: () => Promise<void>
  /** ステージを移るときに呼ぶ。同じ出力先でコントローラだけを作り直す（ゾーンの記憶を消す） */
  renew: () => Promise<void>
}

// 開発中は既定で無音（VITE_ALERT_SOUND=on のときだけ鳴らす）。本番ビルドは常に鳴らす
const defaultPort = (): AudioPort =>
  alertSoundEnabled(import.meta.env) ? new WebAudioPort(SOUND_URLS) : new SilentAudioPort()

export function useAlertSound(createPort: () => AudioPort = defaultPort): AlertSound {
  const [controller, setController] = useState<AlertSoundController | null>(null)
  const port = useRef<AudioPort | null>(null)

  const attach = useCallback(async (to: AudioPort) => {
    const next = new AlertSoundController(to, {
      onError: (event) => logger.warn(event, { feature: 'drive' }),
    })
    // 前のコントローラは下の effect の片づけで止める
    setController(next)
    await next.unlock()
  }, [])

  const start = useCallback(async () => {
    port.current = createPort()
    await attach(port.current)
  }, [createPort, attach])

  const renew = useCallback(async () => {
    // 出力先がまだ無い（出発の前）なら何もしない。解除済みの出力先の unlock は操作の外でも通る
    if (port.current) await attach(port.current)
  }, [attach])

  // 画面を離れたら止める（コントローラの寿命は外部資源なので effect で片づける）
  // eslint-disable-next-line no-restricted-syntax -- Web Audio のタイマーの片づけ（外部資源の寿命）
  useEffect(() => () => controller?.dispose(), [controller])

  return { controller, start, renew }
}
