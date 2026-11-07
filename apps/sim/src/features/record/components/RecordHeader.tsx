import { recordText, type RecordView } from '@antler/trip'
import { useState } from 'react'
import { BrandLogo } from '@/shared/components/BrandLogo'
import { useSaveImage } from '../hooks/useRecordActions'
import { recordShareUrl } from '../utils/links'

// 上部: ブランド・記録 URL・リンクのコピー・しおりの画像の保存（R5・R6、UC-9a・UC-9b、FAIL-5）

type CopyState = 'idle' | 'copied' | 'failed'

export function RecordHeader({ tripId, lang }: { tripId: string; lang: RecordView['lang'] }) {
  const [copy, setCopy] = useState<CopyState>('idle')
  const saveImage = useSaveImage(tripId)
  const url = recordShareUrl(tripId)
  const t = (key: Parameters<typeof recordText>[0]) => recordText(key, lang)

  const onCopy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(url)
      setCopy('copied')
    } catch {
      setCopy('failed')
    }
  }

  return (
    <header className="record-header">
      <span className="record-brand">
        <BrandLogo theme="trip" />
      </span>
      <div className="record-share">
        <input
          className="record-url"
          aria-label={t('urlLabel')}
          type="text"
          readOnly
          value={url}
          onFocus={(e) => {
            e.currentTarget.select()
          }}
        />
        <button
          type="button"
          className="record-button record-button--primary"
          onClick={() => void onCopy()}
        >
          {t('copyLink')}
        </button>
        <button
          type="button"
          className="record-button record-button--secondary"
          aria-disabled={saveImage.isPending}
          onClick={() => {
            // disabled にするとフォーカスが外れるので、押せる見た目のまま二重の保存を止める
            if (!saveImage.isPending) saveImage.mutate()
          }}
        >
          {t('saveImage')}
        </button>
      </div>
      <p className="record-share-status" role="status">
        {copy === 'copied' ? t('copied') : copy === 'failed' ? t('copyFailed') : ''}
        {saveImage.isError ? t('saveImageFailed') : saveImage.isSuccess ? t('imageSaved') : ''}
      </p>
    </header>
  )
}
