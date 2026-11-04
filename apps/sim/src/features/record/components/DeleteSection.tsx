import type { Lang } from '@antler/schema'
import { recordText } from '@antler/trip'
import type { UseMutationResult } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { RecordApiError } from '../types'

// 記録の削除（docs/specs/record/functional.md R10、UC-9c・UC-9d、FAIL-4）。
// 所有者トークンのある端末だけに出す。確かめずに消えない（「削除する」を押すまで送らない）。
// 確認を開いたら確認の文にフォーカスを移し、「やめる」で開いたボタンに戻す（WCAG 2.4.3）。

const CONFIRM_ID = 'record-delete-confirm'

function failureText(error: Error, lang: Lang): string {
  if (error instanceof RecordApiError) {
    if (error.status === 403 || error.status === 401) return recordText('deleteForbidden', lang)
    if (error.status === null) return recordText('deleteOffline', lang)
  }
  return recordText('deleteFailed', lang)
}

/** 確認の文が出たらフォーカスを移す（ref のコールバック。useEffect を使わない） */
function focusOnMount(el: HTMLParagraphElement | null): void {
  el?.focus()
}

export function DeleteSection({
  lang,
  isOwner,
  mutation,
}: {
  lang: Lang
  isOwner: boolean
  mutation: UseMutationResult<void, Error, void>
}) {
  const [confirming, setConfirming] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const t = (key: Parameters<typeof recordText>[0]) => recordText(key, lang)

  if (!isOwner) return <p className="record-delete-note">{t('deleteOtherDevice')}</p>

  return (
    <section className="record-delete" aria-labelledby="record-delete">
      <h2 id="record-delete" className="record-delete__heading">
        {t('deleteHeading')}
      </h2>
      <button
        ref={trigger}
        type="button"
        className="record-button record-button--secondary"
        aria-expanded={confirming}
        aria-controls={CONFIRM_ID}
        onClick={() => {
          setConfirming(true)
        }}
      >
        {t('deleteHeading')}
      </button>
      {confirming ? (
        <div id={CONFIRM_ID} className="record-delete__confirm">
          <p ref={focusOnMount} tabIndex={-1}>
            {t('deleteConfirm')}
          </p>
          <div className="record-delete__buttons">
            <button
              type="button"
              className="record-button record-button--danger"
              aria-disabled={mutation.isPending}
              onClick={() => {
                if (!mutation.isPending) mutation.mutate()
              }}
            >
              {t('deleteAction')}
            </button>
            <button
              type="button"
              className="record-button record-button--secondary"
              onClick={() => {
                setConfirming(false)
                mutation.reset()
                trigger.current?.focus()
              }}
            >
              {t('deleteCancel')}
            </button>
          </div>
          {mutation.isError ? (
            <p role="alert" className="record-delete__error">
              {failureText(mutation.error, lang)}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
