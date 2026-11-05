import { resolveLang } from '@antler/alert-ui'
import { useRef, useState } from 'react'
import { useEdgeConnection } from '../hooks/use-edge-connection'
import { useLocationState } from '../hooks/use-location-state'
import { useZones } from '../hooks/use-zones'
import { useNow } from '../hooks/use-now'
import { useSoundLifecycle } from '../hooks/use-sound-lifecycle'
import { CONNECT_TEXT } from '../i18n'
import { receiveRate } from '../lib/link-stats'
import { requestLocationOnce } from '../lib/location'
import { createBrowserServices } from '../services'
import type { ConnectServices } from '../types'
import { ConnectScreen } from './ConnectScreen'
import { DriveScreen } from './DriveScreen'
import './connect.css'

// B-0（接続・音の解除・出発）→ B-1（走行中の表示）。B-1 から B-0 に戻る操作は置かない。戻るのは再読み込み。
// State設計: Server state なし / Shared state なし / Local UI: services・flow（段階と音の解除の結果）/ useEffect: 音の後始末のみ

type SoundResult = 'pending' | 'ok' | 'failed'
type Flow = { stage: 'connect' } | { stage: 'drive'; departedAt: number; sound: SoundResult }

/** 音の解除がこの時間たっても決着しなければ、音が出ないものとして知らせる。 */
const UNLOCK_GRACE_MS = 3000

export function ConnectFlow({ services }: { services?: ConnectServices }) {
  const [svc] = useState(() => services ?? createBrowserServices())
  const [flow, setFlow] = useState<Flow>({ stage: 'connect' })
  const departed = useRef(false)

  const { snapshot, sendAck, sendVehicle } = useEdgeConnection(svc.url, svc.createSocket)
  const now = useNow()
  const location = useLocationState(svc.location)
  const { zones, failed: zonesFailed } = useZones(svc.loadZones)
  const lang = resolveLang(svc.languages)
  const text = CONNECT_TEXT[lang]

  useSoundLifecycle(svc.sound)

  const depart = () => {
    if (departed.current) return
    departed.current = true
    // ユーザー操作の中で、音の解除・読み上げの解除・位置の許可を始める
    const unlocking = svc.sound.unlock()
    svc.primeSpeech()
    requestLocationOnce(svc.location, location ?? 'unknown')
    setFlow({ stage: 'drive', departedAt: Date.now(), sound: 'pending' })
    void unlocking.then((ok) => {
      if (ok) svc.playTestSound()
      setFlow((f) => (f.stage === 'drive' ? { ...f, sound: ok ? 'ok' : 'failed' } : f))
    })
  }

  const noSound =
    flow.stage === 'drive' &&
    (flow.sound === 'failed' ||
      (flow.sound === 'ok' && !svc.sound.canPlay) ||
      (flow.sound === 'pending' && now - flow.departedAt > UNLOCK_GRACE_MS))

  return (
    <div className="connect-root" data-theme="night">
      {flow.stage === 'connect' ? (
        <ConnectScreen
          text={text}
          lang={lang}
          status={snapshot.status}
          rate={receiveRate(snapshot.receivedAt, now)}
          delayMs={snapshot.lastDelayMs}
          location={location}
          onDepart={depart}
        />
      ) : (
        <DriveScreen
          text={text}
          lang={lang}
          snapshot={snapshot}
          now={now}
          location={location}
          sound={svc.sound}
          noSound={noSound}
          sendAck={sendAck}
          sendVehicle={sendVehicle}
          geo={svc.geo}
          wakeLock={svc.wakeLock}
          zones={zones}
          zonesFailed={zonesFailed}
        />
      )}
    </div>
  )
}
