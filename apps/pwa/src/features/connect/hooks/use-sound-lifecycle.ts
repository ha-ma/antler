import type { AlertSoundController } from '@antler/alert-ui'
import { useEffect } from 'react'

/** 画面を閉じたら、鳴っているビープと発話を止める。 */
export function useSoundLifecycle(sound: AlertSoundController): void {
  // eslint-disable-next-line no-restricted-syntax -- 外部（Web Audio）の後始末。購読の hook に隔離
  useEffect(
    () => () => {
      sound.dispose()
    },
    [sound],
  )
}
