import type { Lang } from '@antler/schema'
import { Link } from 'react-router'
import { briefHref } from '../hooks/useBriefParams'
import { BRIEF_TEXT, fillText, type BriefTextKey } from '../text'

const STEPS: readonly BriefTextKey[] = ['stepPlan', 'stepBrief', 'stepDrive', 'stepRecord']

type Props = { lang: Lang; tripId: string; day: number; dayCount: number; alertOn: boolean }

/** ヘッダー: ロゴ、4 段の進み具合（1 は完了、2 が現在）、D1〜Dn の切り替え（R6） */
export function BriefHeader({ lang, tripId, day, dayCount, alertOn }: Props) {
  const t = BRIEF_TEXT
  return (
    <header className="brief-header">
      <div className="brief-brand">
        <svg
          className="brief-brand__logo"
          viewBox="0 0 32 20"
          width="32"
          height="20"
          aria-hidden="true"
          focusable="false"
        >
          <path className="brief-brand__ridge" d="M1 18 L11 4 L17 12 L22 6 L31 18" />
          <path className="brief-brand__road" d="M6 18 L16 14 L26 18" />
        </svg>
        <span>{t.brand[lang]}</span>
      </div>
      <ol className="brief-steps" aria-label={t.steps[lang]}>
        {STEPS.map((key, i) => (
          <li
            key={key}
            className={`brief-step${i === 0 ? ' brief-step--done' : ''}${i === 1 ? ' brief-step--current' : ''}`}
            aria-current={i === 1 ? 'step' : undefined}
          >
            {i === 0 ? (
              <svg
                className="brief-step__check"
                viewBox="0 0 16 16"
                width="14"
                height="14"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M3 8.5 L6.5 12 L13 4.5" />
              </svg>
            ) : (
              <span className="brief-num">{i + 1}</span>
            )}{' '}
            {t[key][lang]}
            {i === 0 ? <span className="brief-visually-hidden">（{t.stepDone[lang]}）</span> : null}
          </li>
        ))}
      </ol>
      {dayCount > 1 ? (
        <nav className="brief-days" aria-label={t.days[lang]}>
          {Array.from({ length: dayCount }, (_, i) => i + 1).map((n) => (
            <Link
              key={n}
              className="brief-day"
              to={briefHref(tripId, n, alertOn)}
              aria-current={n === day ? 'page' : undefined}
            >
              {fillText(t.dayN[lang], { n })}
            </Link>
          ))}
        </nav>
      ) : null}
    </header>
  )
}
