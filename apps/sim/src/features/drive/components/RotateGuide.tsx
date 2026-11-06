import type { Lang } from '@antler/schema'
import { LANGS, MOBILE_TEXT } from './mobile-text'

/**
 * 縦画面のときの「横にしてください」（docs/specs/mobile-landscape/functional.md R2）。
 * 運転画面の全面を覆う。操作要素なし。主文はその旅の言語、副文に残り 3 言語
 */
export function RotateGuide({ lang }: { lang: Lang }) {
  const main = MOBILE_TEXT[lang].rotate
  return (
    <section className="drive-rotate" role="alert" data-testid="rotate-guide">
      <svg
        className="drive-rotate__icon"
        viewBox="0 0 64 64"
        width="64"
        height="64"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {/* 縦の端末 → 横の端末へ回る矢印 */}
        <rect x="8" y="18" width="20" height="36" rx="3" />
        <rect x="26" y="38" width="32" height="18" rx="3" />
        <path d="M34 8a18 18 0 0 1 18 18" />
        <path d="M52 18v8h-8" />
      </svg>
      <p className="drive-rotate__title" lang={lang}>
        {main.title}
      </p>
      <p className="drive-rotate__note" lang={lang}>
        {main.note}
      </p>
      <ul className="drive-rotate__others">
        {LANGS.filter((l) => l !== lang).map((l) => (
          <li key={l} lang={l}>
            {MOBILE_TEXT[l].rotate.title}
          </li>
        ))}
      </ul>
    </section>
  )
}
