import { AlertState, type Lang } from '@antler/alert-ui'
import type { ConnectText } from '../i18n'
import type { LinkStatus } from '../lib/edge-client'
import type { LocationState } from '../lib/location'
import { LinkIcon } from './LinkIcon'
import './connect.css'

// B-0 接続（ch4 B4-1）。唯一の操作画面。操作は「テスト音を鳴らして出発」の 1 つだけ。

type Props = {
  text: ConnectText
  lang: Lang
  status: LinkStatus
  /** 直近 5 秒の受信/秒。受信が無ければ undefined */
  rate: number | undefined
  /** 直近のフラグの t_sent − t_frame（ms） */
  delayMs: number | undefined
  location: LocationState | null
  onDepart: () => void
}

const LINK_TEXT = {
  open: 'linkOpen',
  connecting: 'linkConnecting',
  closed: 'linkClosed',
} as const satisfies Record<LinkStatus, keyof ConnectText>

const LOCATION_TEXT = {
  granted: 'locationGranted',
  prompt: 'locationPrompt',
  denied: 'locationDenied',
  unknown: 'locationUnknown',
  insecure: 'locationInsecure',
} as const satisfies Record<LocationState, keyof ConnectText>

export function ConnectScreen({ text, lang, status, rate, delayMs, location, onDepart }: Props) {
  return (
    <main className="connect" lang={lang}>
      <h1 className="connect__title">{text.title}</h1>

      <section className="connect__card" aria-labelledby="connect-link">
        <h2 id="connect-link" className="connect__heading">
          {text.linkTitle}
        </h2>
        <p className="connect__status" data-link-status={status} role="status">
          <LinkIcon status={status} />
          <span>{text[LINK_TEXT[status]]}</span>
        </p>
      </section>

      <section className="connect__card" aria-labelledby="connect-camera">
        <h2 id="connect-camera" className="connect__heading">
          {text.cameraTitle}
        </h2>
        <dl className="connect__stats">
          <div>
            <dt>{text.rateLabel}</dt>
            <dd data-testid="rate">{rate === undefined ? '--' : rate.toFixed(1)}</dd>
          </div>
          <div>
            <dt>{text.delayLabel}</dt>
            <dd data-testid="delay">{delayMs === undefined ? '--' : Math.round(delayMs)}</dd>
          </div>
        </dl>
      </section>

      <section className="connect__card" aria-labelledby="connect-volume">
        <h2 id="connect-volume" className="connect__heading">
          {text.volumeTitle}
        </h2>
        <p className="connect__body">{text.volumeGuide}</p>
      </section>

      <section className="connect__card" aria-labelledby="connect-preview">
        <h2 id="connect-preview" className="connect__heading">
          {text.previewTitle}
        </h2>
        <ul className="connect__previews">
          {(
            [
              ['safe', text.previewSafe],
              ['zone', text.previewZone],
              ['danger', text.previewDanger],
            ] as const
          ).map(([state, label]) => (
            <li key={state} className="connect__preview">
              <div className="connect__preview-face" data-preview={state}>
                <AlertState
                  state={state}
                  distance={state === 'danger' ? 50 : 12}
                  side="L"
                  lang={lang}
                  compact
                  muted
                />
              </div>
              <span className="connect__preview-label">{label}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="connect__card" aria-labelledby="connect-location">
        <h2 id="connect-location" className="connect__heading">
          {text.locationTitle}
        </h2>
        <p className="connect__body" data-location={location ?? 'checking'}>
          {text[LOCATION_TEXT[location ?? 'unknown']]}
        </p>
      </section>

      <div className="connect__depart-area">
        <p className="connect__body">{text.departNote}</p>
        <button type="button" className="connect__depart" onClick={onDepart}>
          {text.depart}
        </button>
      </div>
    </main>
  )
}
