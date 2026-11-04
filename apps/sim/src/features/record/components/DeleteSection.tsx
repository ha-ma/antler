import type { Lang } from '@antler/schema'
import { recordText } from '@antler/trip'
import type { UseMutationResult } from '@tanstack/react-query'
import { useState } from 'react'
import { RecordApiError } from '../types'

// 記録の削除（docs/specs/record/functional.md R10、UC-9c・UC-9d、FAIL-4）。
// 所有者トークンのある端末だけに出す。確かめずに消えない（「削除する」を押すまで送らない）。

function failureText(error: Error, lang: Lang): string {
  if (error instanceof RecordApiError) {
    if (error.status === 403 || error.status === 401) return recordText('deleteForbidden', lang)
    if (error.status === null) return recordText('deleteOffline', lang)
  }
  return recordText('deleteFailed', lang)
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
  const t = (key: Parameters<typeof recordText>[0]) => recordText(key, lang)

  if (!isOwner) return <p className="record-delete-note">{t('deleteOtherDevice')}</p>

  return (
    <section className="record-delete" aria-labelledby="record-delete">
      <h2 id="record-delete" className="record-delete__heading">
        {t('deleteHeading')}
      </h2>
      {confirming ? (
        <div className="record-delete__confirm">
          <p>{t('deleteConfirm')}</p>
          <div className="record-delete__buttons">
            <button
              type="button"
              className="record-button record-button--danger"
              disabled={mutation.isPending}
              onClick={() => {
                mutation.mutate()
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
      ) : (
        <button
          type="button"
          className="record-button record-button--secondary"
          onClick={() => {
            setConfirming(true)
          }}
        >
          {t('deleteHeading')}
        </button>
      )}
    </section>
  )
}
