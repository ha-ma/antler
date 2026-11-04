import type { Lang } from '@antler/schema'
import { buildRecordView, recordText } from '@antler/trip'
import { useMemo } from 'react'
import { Link, useParams } from 'react-router'
import { ownerTokenOf } from '@/features/plan-trip'
import { useDeleteTrip } from '../hooks/useRecordActions'
import { useTripRecord } from '../hooks/useTripRecord'
import { RecordApiError, type RecordData } from '../types'
import { challengeOffHref, pwaUrl } from '../utils/links'
import { DeleteSection } from './DeleteSection'
import { RecordHeader } from './RecordHeader'
import { BIntro, KeptList, ShioriCard, StatTiles, ZoneLog } from './RecordSections'
import './record.css'

// `/t/:id` — A-7 旅の記録（docs/specs/record/functional.md R5・R8〜R10、UI キャンバス v2 の A7_Record）。
// 共有する URL は api の SSR（/t/:id）。この画面はその URL のコピー・画像の保存・挑戦・削除ができる側。

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
  if (query.isPending) {
    return (
      <main className="record record--status" aria-busy="true">
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
  return (
    <RecordContent
      data={query.data}
      isOwner={ownerTokenOf(query.data.trip.id) !== null}
      deletion={deletion}
    />
  )
}

function RecordContent({
  data,
  isOwner,
  deletion,
}: {
  data: RecordData
  isOwner: boolean
  deletion: ReturnType<typeof useDeleteTrip>
}) {
  const view = useMemo(() => buildRecordView(data.trip, data.record), [data])
  const { lang } = view
  const t = (key: Parameters<typeof recordText>[0]) => recordText(key, lang)

  return (
    <div className="record" lang={htmlLang(lang)} data-theme="trip">
      <title>{`${recordText('pageTitle', lang).replace('{title}', view.title)}`}</title>
      <RecordHeader tripId={data.trip.id} lang={lang} />
      <main className="record-main">
        <div className="record-col">
          <div className="record-intro">
            <span className="record-eyebrow">{view.eyebrow}</span>
            <h1 ref={focusOnMount} tabIndex={-1}>
              {view.heading}
            </h1>
            <p className="record-subtitle">{view.title}</p>
            <p className="record-lead">{view.summary}</p>
          </div>
          <StatTiles view={view} />
          <KeptList view={view} />
          <ZoneLog view={view} />
        </div>
        <aside className="record-aside">
          <ShioriCard view={view} />
          <BIntro lang={lang} href={pwaUrl()} />
          <nav className="record-actions" aria-label={t('shioriHeading')}>
            <Link className="record-button record-button--primary" to="/plan">
              {t('planAnother')}
            </Link>
            <Link
              className="record-button record-button--secondary"
              to={challengeOffHref(data.trip.id, data.record.lastDay)}
            >
              {t('challengeOff')}
            </Link>
          </nav>
          {isOwner ? null : <p className="record-note">{t('challengeNotSaved')}</p>}
          <DeleteSection lang={lang} isOwner={isOwner} mutation={deletion} />
        </aside>
      </main>
    </div>
  )
}
