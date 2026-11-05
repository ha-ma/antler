import type { Lang } from '@antler/schema'
import { recordText } from '@antler/trip'

// 「実際の旅にも、同じアラートを」— B（車載アラート）への導線（A7-3、docs/specs/record/functional.md R8）。
// 夜のテーマ（data-theme="night"）。スマホの印は safe の形（円＋チェック）で、色だけにしない。

export function BIntro({ lang, href }: { lang: Lang; href: string }) {
  const t = (key: Parameters<typeof recordText>[0]) => recordText(key, lang)
  return (
    <section className="record-b" data-theme="night" aria-labelledby="record-b">
      <div className="record-b__head">
        <div className="record-b__phone" aria-hidden="true">
          <svg viewBox="0 0 20 20">
            <circle cx="10" cy="10" r="9" />
            <path
              d="M6 10.5l3 3 5-6"
              fill="none"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div>
          <h2 id="record-b">{t('bHeading')}</h2>
          <p>{t('bBody')}</p>
        </div>
      </div>
      <ul>
        <li>{t('bPoint1')}</li>
        <li>{t('bPoint2')}</li>
        <li>{t('bPoint3')}</li>
      </ul>
      <a className="record-b__link" href={href}>
        {t('bLink')} <span aria-hidden="true">→</span>
      </a>
    </section>
  )
}
