import {
  AlertSoundContext,
  AlertState,
  type AlertSoundController,
  type Lang,
} from '@antler/alert-ui'
import type { ZoneCollection } from '@antler/zones'
import { useDriveAlert, useAckOnDanger } from '../hooks/use-drive-alert'
import { useGpsZone } from '../hooks/use-gps-zone'
import { useWakeLock } from '../hooks/use-wake-lock'
import type { ConnectText } from '../i18n'
import type { EdgeSnapshot } from '../lib/edge-client'
import type { GeoWatch } from '../lib/gps'
import type { LocationState } from '../lib/location'
import type { WakeLockDeps } from '../lib/wake-lock'
import './connect.css'

// B-1 / B-2 走行中の表示。操作要素を置かない（ch4 B4-6）。AlertState の面は変えず、「未接続」帯などはその上に並べる。
// GPS × 鹿ゾーンの判定はスマホ側で行う（B4-5）。Mac Mini が無くても緑・琥珀は出る。

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
  geo: GeoWatch | undefined
  wakeLock: WakeLockDeps
  /** 同梱の鹿ゾーン DB。読み込み中・失敗は null */
  zones: ZoneCollection | null
  zonesFailed: boolean
}

/** 同じ関数を渡し続ける（描画のたびに呼ばれて 1 秒ごとにフォーカスを奪わないように）。 */
function focusOnMount(el: HTMLElement | null): void {
  el?.focus({ preventScroll: true })
}

/** JST の ISO 8601（+09:00）から時刻 HH:MM を取り出す。 */
function clockOf(isoJst: string): string {
  return isoJst.slice(11, 16)
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
  geo,
  wakeLock,
  zones,
  zonesFailed,
}: Props) {
  const permitted = location !== 'denied' && location !== 'insecure'
  const view = useGpsZone({ geo, enabled: permitted, zones, now })
  const alert = useDriveAlert(snapshot, now, view.gps)
  useAckOnDanger(alert.state, () => {
    sendAck(Date.now())
  })
  const wake = useWakeLock(wakeLock)

  const open = snapshot.status === 'open'
  const noLocation = !permitted || view.denied
  const notes = [
    noSound && ['no-sound', text.noSound],
    noLocation && ['no-location', text.noLocation],
    view.lost && ['gps-lost', text.gpsLost],
    view.poorAccuracy && ['poor-accuracy', text.poorAccuracy],
    zonesFailed && ['zones-unavailable', text.zonesUnavailable],
    wake.failed && ['no-wake-lock', text.noWakeLock],
  ].filter((n): n is [string, string] => Array.isArray(n))

  const route = view.roadName?.[lang]
  const eta = view.eta ? clockOf(view.eta) : undefined

  return (
    // 出発でボタンが消えるので、フォーカスをこの領域に移す（キーボード・スクリーンリーダーの位置が失われない）
    <main className="drive" lang={lang} aria-label={text.title} tabIndex={-1} ref={focusOnMount}>
      {/* ライブリージョンは常に置き、中身だけ入れ替える（あとから現れた領域は読まれない SR が多い） */}
      <div
        className="drive__band"
        role="status"
        data-visible={open ? 'false' : 'true'}
        data-testid="band"
      >
        {open ? '' : text.band}
      </div>
      <ul className="drive__notes" role="status" data-visible={notes.length > 0 ? 'true' : 'false'}>
        {notes.map(([key, label]) => (
          <li key={key} data-testid={`note-${key}`}>
            {label}
          </li>
        ))}
      </ul>
      <p className="drive__route" data-visible={route ? 'true' : 'false'} data-testid="route">
        {route}
        {route && eta ? ` ・ ${text.etaLabel} ${eta}` : ''}
      </p>
      <div className="drive__alert">
        <AlertSoundContext.Provider value={sound}>
          <AlertState state={alert.state} distance={alert.distance} side={alert.side} lang={lang} />
        </AlertSoundContext.Provider>
      </div>
    </main>
  )
}
