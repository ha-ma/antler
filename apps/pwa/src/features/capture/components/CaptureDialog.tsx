import { resolveLang } from '@antler/alert-ui'
import { useState } from 'react'
import { useSend } from '../hooks/use-send'
import { CAPTURE_TEXT, fill, type CaptureText } from '../i18n'
import { imageUrl, type PendingList } from '../lib/edge-api'
import type { SendStop } from '../lib/send-all'
import type { CaptureServices } from '../types'
import { CaptureIcon } from './CaptureIcon'
import './capture.css'

// 走行後の同意画面（night テーマ。P2）。操作は「提供する（匿名）」のチェック・主ボタン・「あとで」だけ。
// State設計: Server state なし（一覧は props、送信は useSend の mutation） / Shared state なし / Local UI: consent / useEffect なし

const MAX_THUMBS = 6

const STOP_TEXT = {
  network: 'stopNetwork',
  busy: 'stopBusy',
  misconfigured: 'stopMisconfigured',
  edge: 'stopEdge',
} as const satisfies Record<SendStop, keyof CaptureText>

type Props = {
  svc: CaptureServices
  apiBaseUrl: string
  list: PendingList
  onClose: () => void
}

/** 開いたとき、画面の先頭（見出し）に読み上げと操作を移す。参照を固定して、再描画のたびに奪わない。 */
function focusOnMount(element: HTMLElement | null): void {
  element?.focus()
}

export function CaptureDialog({ svc, apiBaseUrl, list, onClose }: Props) {
  const [consent, setConsent] = useState(true)
  const { phase, totals, waiting, stop, send } = useSend(svc, apiBaseUrl)
  const lang = resolveLang(svc.languages)
  const text = CAPTURE_TEXT[lang]
  const total = list.total
  const handled = totals.provided + totals.failed + totals.removed
  const percent = total > 0 ? Math.min(100, Math.round((handled / total) * 100)) : 0

  let message = ''
  if (phase === 'sending') {
    message = waiting ? text.waiting : text.sending
  } else if (phase === 'done') {
    message = consent
      ? fill(text.doneProvided, { n: totals.provided, m: totals.failed })
      : fill(text.doneDeclined, { n: totals.removed })
  } else if (phase === 'stopped' && stop) {
    message = text[STOP_TEXT[stop]]
  }

  return (
    <div className="capture-gate" data-theme="night">
      <section
        ref={focusOnMount}
        className="capture"
        role="dialog"
        aria-modal="true"
        aria-labelledby="capture-title"
        lang={lang}
        tabIndex={-1}
      >
        <h2 id="capture-title" className="capture__title">
          <CaptureIcon />
          <span>{fill(text.title, { n: total })}</span>
        </h2>

        {phase === 'idle' && (
          <>
            <ul className="capture__notes">
              <li>{text.noteAnon}</li>
              <li>{text.noteScene}</li>
              <li>{text.notePlace}</li>
              <li>{text.noteNoChange}</li>
              <li>{text.noteErase}</li>
            </ul>

            <p className="capture__label">{text.thumbsLabel}</p>
            <ul className="capture__thumbs">
              {list.items.slice(0, MAX_THUMBS).map((item, index) => (
                <li key={item.id} className="capture__thumb">
                  <img
                    src={imageUrl(svc.edgeBaseUrl, item.id)}
                    alt={`${text.thumbAlt} ${index + 1}`}
                    width="160"
                    height="120"
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                  />
                </li>
              ))}
            </ul>

            <label className="capture__consent">
              <input
                type="checkbox"
                className="capture__check"
                checked={consent}
                onChange={(event) => {
                  setConsent(event.target.checked)
                }}
              />
              <span>{text.consentLabel}</span>
            </label>

            <div className="capture__actions">
              <button
                type="button"
                className="capture__button capture__button--primary"
                aria-label={fill(consent ? text.sendAria : text.declineAria, { n: total })}
                onClick={() => {
                  send(consent)
                }}
              >
                {consent ? text.send : text.decline}
              </button>
              <button
                type="button"
                className="capture__button capture__button--secondary"
                aria-label={text.laterAria}
                onClick={onClose}
              >
                {text.later}
              </button>
            </div>
          </>
        )}

        {phase === 'sending' && consent && (
          <div className="capture__progress" aria-hidden="true">
            <div className="capture__bar">
              <div className="capture__bar-fill" style={{ width: `${percent}%` }} />
            </div>
          </div>
        )}

        <p className="capture__status" role="status" aria-live="polite">
          {message}
        </p>
        {phase === 'sending' && consent && (
          <p className="capture__count">{fill(text.progress, { done: handled, total })}</p>
        )}

        {phase === 'stopped' && (
          <div className="capture__actions">
            <button
              type="button"
              className="capture__button capture__button--primary"
              onClick={() => {
                send(consent)
              }}
            >
              {text.retry}
            </button>
            <button
              type="button"
              className="capture__button capture__button--secondary"
              onClick={onClose}
            >
              {text.later}
            </button>
          </div>
        )}
        {phase === 'done' && (
          <div className="capture__actions">
            <button
              type="button"
              className="capture__button capture__button--primary"
              onClick={onClose}
            >
              {text.close}
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
