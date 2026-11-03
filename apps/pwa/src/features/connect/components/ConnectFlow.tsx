import { resolveLang } from '@antler/alert-ui'
import { useRef, useState } from 'react'
import { useEdgeConnection } from '../hooks/use-edge-connection'
import { useLocationState } from '../hooks/use-location-state'
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
// State設計: Server state なし / Shared state なし / Local UI: stage・soundResult・services / useEffect: 音の後始末のみ

type SoundResult = 'pending' | 'ok' | 'failed'

export function ConnectFlow({ services }: { services?: ConnectServices }) {
  const [svc] = useState(() => services ?? createBrowserServices())
  const [stage, setStage] = useState<'connect' | 'drive'>('connect')
  const [soundResult, setSoundResult] = useState<SoundResult>('pending')
  const departed = useRef(false)

  const { snapshot, sendAck } = useEdgeConnection(svc.url, svc.createSocket)
  const now = useNow()
  const location = useLocationState(svc.location)
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
    setStage('drive')
    void unlocking.then((ok) => {
      if (ok) svc.playTestSound()
      setSoundResult(ok ? 'ok' : 'failed')
    })
  }

  const noSound = soundResult === 'failed' || (soundResult === 'ok' && !svc.sound.canPlay)

  return (
    <div className="connect-root" data-theme="night">
      {stage === 'connect' ? (
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
        />
      )}
    </div>
  )
}
