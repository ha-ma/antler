import { AlertSoundContext, AlertState, type AlertSoundController } from '@antler/alert-ui'
import type { DriveEngine } from '../domain/engine'
import { useDriveSnapshot } from '../hooks/use-drive-snapshot'

type Props = {
  engine: DriveEngine
  controller: AlertSoundController | null
  /** 音トグル OFF・一時停止・終了のとき true */
  muted: boolean
}

/**
 * 車内スマホの画面（R7）。B の PWA と同じ AlertState の compact。音は AlertState が props の変化ごとに
 * コントローラへ渡す（距離が縮むとビープが速くなる）。3D の中（別の React ルート）に貼られるので、
 * Provider もこの中に置き、値は自分でエンジンから購読する。
 */
export function PhoneScreen({ engine, controller, muted }: Props) {
  const { alert, lang } = useDriveSnapshot(engine)
  return (
    <AlertSoundContext.Provider value={controller}>
      <AlertState
        state={alert.state}
        distance={alert.distance}
        side={alert.side}
        lang={lang}
        compact
        muted={muted}
      />
    </AlertSoundContext.Provider>
  )
}
