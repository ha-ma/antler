import type { Lang } from '@antler/schema'
import { buildRecordView, recordText } from '@antler/trip'
import type { UseMutationResult } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Link } from 'react-router'
import { ActionBar, ACTION_BAR_PRIMARY } from '@/shared/components/ActionBar'
import { useCelebration } from '../hooks/useCelebration'
import { useIsOwner } from '../hooks/useIsOwner'
import type { RecordData } from '../types'
import { challengeOffHref, pwaUrl } from '../utils/links'
import { BIntro } from './BIntro'
import { ClearBanner } from './ClearBanner'
import { DeleteSection } from './DeleteSection'
import { KeptList } from './KeptList'
import { RecordHeader } from './RecordHeader'
import { ShioriCard } from './ShioriCard'
import { StatTiles } from './StatTiles'
import { ZoneLog } from './ZoneLog'

// A-7 の本体（docs/specs/record/functional.md R5・R8〜R10）。表示の形は @antler/trip の buildRecordView
// （api の SSR・OG 画像と同じもの）。

const htmlLang = (lang: Lang) => (lang === 'zh' ? 'zh-Hant' : lang)

/** 遷移してきたら見出しにフォーカスを移す（ref のコールバック。useEffect を使わない） */
function focusOnMount(el: HTMLHeadingElement | null): void {
  el?.focus()
}

export function RecordContent({
  data,
  deletion,
}: {
  data: RecordData
  deletion: UseMutationResult<void, Error, void>
}) {
  const view = useMemo(() => buildRecordView(data.trip, data.record), [data])
  const isOwner = useIsOwner(data.trip.id)
  // 鹿にぶつからずに走りきった直後だけ「クリア」。衝突のあと（A-6 から）は一切出さない（result-screens R3・R4）
  const { celebration, onShown } = useCelebration(data.record)
  const { lang } = view
  const t = (key: Parameters<typeof recordText>[0]) => recordText(key, lang)

  return (
    <div className="record" lang={htmlLang(lang)} data-theme="trip">
      <title>{recordText('pageTitle', lang, { title: view.title })}</title>
      <RecordHeader tripId={data.trip.id} lang={lang} />
      <main className="record-main">
        <div className="record-col">
          {celebration ? <ClearBanner day={celebration.day} lang={lang} onShown={onShown} /> : null}
          <div className="record-intro">
            <span className="record-eyebrow">{view.eyebrow}</span>
            {/* 祝いを出すときは「クリア」がフォーカスを受ける（両方に付けると後のほうが勝つ） */}
            <h1 ref={celebration ? undefined : focusOnMount} tabIndex={-1}>
              {view.heading}
            </h1>
            <p className="record-subtitle">{view.title}</p>
            <p className="record-lead">{view.summary}</p>
            {/* 鹿の発見の 1 行（drive-crash-spot R4。並べ方は result-screens に任せる） */}
            {view.spotting && (
              <p className="record-lead" data-testid="record-spotting">
                {view.spotting}
              </p>
            )}
          </div>
          <StatTiles view={view} />
          <KeptList view={view} />
          <ZoneLog view={view} />
        </div>
        <aside className="record-aside">
          <ShioriCard view={view} />
          <BIntro lang={lang} href={pwaUrl()} />
          <nav className="record-actions" aria-label={t('shioriHeading')}>
            {/* 次へ進む主ボタンは画面の下に固定した帯（sticky-cta R5）。DOM の位置は今までどおり */}
            <ActionBar>
              <Link
                className={`record-button record-button--primary ${ACTION_BAR_PRIMARY}`}
                to="/plan"
              >
                {t('planAnother')}
              </Link>
            </ActionBar>
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
