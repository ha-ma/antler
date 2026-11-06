import type { Lang } from '@antler/schema'
import { recordText } from '@antler/trip'
import { Link, useParams } from 'react-router'
import { useDeleteTrip } from '../hooks/useRecordActions'
import { useTripRecord } from '../hooks/useTripRecord'
import { RecordApiError } from '../types'
import { RecordContent } from './RecordContent'
import './record.css'

// `/t/:id` — A-7 旅の記録（docs/specs/record/functional.md R5・R8〜R10、UI キャンバス v2 の A7_Record）。
// 共有する URL は api の SSR（/t/:id）。この画面はその URL のコピー・画像の保存・挑戦・削除ができる側。
// 削除の mutation はここで持つ（成功したら記録の代わりに「削除しました」を出すため）。

const htmlLang = (lang: Lang) => (lang === 'zh' ? 'zh-Hant' : lang)

/** 遷移してきたら見出しにフォーカスを移す（ref のコールバック。useEffect を使わない） */
function focusOnMount(el: HTMLHeadingElement | null): void {
  el?.focus()
}

export function RecordPage() {
  const { id = '' } = useParams()
  const query = useTripRecord(id)
  const deletion = useDeleteTrip(id)
  // 旅が読めるまで言語が分からない。A-1 の既定の ja で出す
  const lang: Lang = query.data?.trip.lang ?? 'ja'
  const t = (key: Parameters<typeof recordText>[0]) => recordText(key, lang)

  if (deletion.isSuccess) {
    return (
      <main className="record record--status" lang={htmlLang(lang)}>
        <h1 ref={focusOnMount} tabIndex={-1}>
          {t('deleted')}
        </h1>
        <Link className="record-button record-button--primary" to="/plan">
          {t('planAnother')}
        </Link>
      </main>
    )
  }
  // キャッシュに前の記録があっても、開いたあとに取り直した記録が来るまで待つ。前の記録で「クリア」を
  // 決めない（result-screens R4。走行の保存は記録を無効にしてから移ってくる）
  if (query.isPending || (query.isFetching && !query.isFetchedAfterMount)) {
    return (
      <main className="record record--status">
        <p role="status">{t('loading')}</p>
      </main>
    )
  }
  if (query.isError) {
    const notFound = query.error instanceof RecordApiError && query.error.status === 404
    return (
      <main className="record record--status">
        <h1 ref={focusOnMount} tabIndex={-1}>
          {notFound ? t('notFound') : t('loadFailed')}
        </h1>
        {notFound ? null : (
          <button
            type="button"
            className="record-button record-button--primary"
            onClick={() => void query.refetch()}
          >
            {t('retry')}
          </button>
        )}
        <Link className="record-button record-button--secondary" to="/plan">
          {t('planOwn')}
        </Link>
      </main>
    )
  }
  return <RecordContent data={query.data} deletion={deletion} />
}
