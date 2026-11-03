import {
  AlertSoundContext,
  AlertState,
  type AlertSoundController,
  type Lang,
} from '@antler/alert-ui'
import { useDriveAlert, useAckOnDanger } from '../hooks/use-drive-alert'
import type { ConnectText } from '../i18n'
import type { EdgeSnapshot } from '../lib/edge-client'
import type { LocationState } from '../lib/location'
import './connect.css'

// B-1 走行中の表示。操作要素を置かない（ch4 B4-6）。AlertState の面は変えず、「未接続」帯などはその上に並べる。

type Props = {
  text: ConnectText
  lang: Lang
  snapshot: EdgeSnapshot
  now: number
  location: LocationState | null
  sound: AlertSoundController
  /** 音の解除の結果が出ていて、音が出せない */
  noSound: boolean
  sendAck: (now: number) => boolean
}

export function DriveScreen({
  text,
  lang,
  snapshot,
  now,
  location,
  sound,
  noSound,
  sendAck,
}: Props) {
  const alert = useDriveAlert(snapshot, now)
  useAckOnDanger(alert.state, () => {
    sendAck(Date.now())
  })

  const open = snapshot.status === 'open'
  const noLocation = location === 'denied' || location === 'insecure'

  return (
    <div className="drive" lang={lang}>
      {/* ライブリージョンは常に置き、中身だけ入れ替える（あとから現れた領域は読まれない SR が多い） */}
      <div
        className="drive__band"
        role="status"
        data-visible={open ? 'false' : 'true'}
        data-testid="band"
      >
        {open ? '' : text.band}
      </div>
      {(noSound || noLocation) && (
        <ul className="drive__notes">
          {noSound && <li data-testid="note-no-sound">{text.noSound}</li>}
          {noLocation && <li data-testid="note-no-location">{text.noLocation}</li>}
        </ul>
      )}
      <div className="drive__alert">
        <AlertSoundContext.Provider value={sound}>
          <AlertState state={alert.state} distance={alert.distance} side={alert.side} lang={lang} />
        </AlertSoundContext.Provider>
      </div>
    </div>
  )
}
