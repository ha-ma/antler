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
  const notes = noSound || noLocation

  return (
    // 出発でボタンが消えるので、フォーカスをこの領域に移す（キーボード・スクリーンリーダーの位置が失われない）
    <main
      className="drive"
      lang={lang}
      aria-label={text.title}
      tabIndex={-1}
      ref={(el) => {
        el?.focus({ preventScroll: true })
      }}
    >
      {/* ライブリージョンは常に置き、中身だけ入れ替える（あとから現れた領域は読まれない SR が多い） */}
      <div
        className="drive__band"
        role="status"
        data-visible={open ? 'false' : 'true'}
        data-testid="band"
      >
        {open ? '' : text.band}
      </div>
      <ul className="drive__notes" role="status" data-visible={notes ? 'true' : 'false'}>
        {noSound && <li data-testid="note-no-sound">{text.noSound}</li>}
        {noLocation && <li data-testid="note-no-location">{text.noLocation}</li>}
      </ul>
      <div className="drive__alert">
        <AlertSoundContext.Provider value={sound}>
          <AlertState state={alert.state} distance={alert.distance} side={alert.side} lang={lang} />
        </AlertSoundContext.Provider>
      </div>
    </main>
  )
}
