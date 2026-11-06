import type { Lang } from '@antler/schema'
import type { CSSProperties } from 'react'
import { clearLead, RECORD_CLEAR_TEXT } from '../text'

// 「クリア」の帯（docs/specs/result-screens/functional.md R3）。鹿にぶつからずに走りきった直後だけ出す（判定は useCelebration）。
// 3 状態の safe と同じ円（alert-safe）が描かれ、チェックが描かれ、「クリア」が出て、控えめな紙吹雪が 1 回だけ落ちる。
// 円・チェック・紙吹雪は飾り（aria-hidden）。「クリア」の文字は見出しにしない（h1 は記録の見出しのまま）。
// 動きを減らす設定では、描き終わった形で出し、紙吹雪は出さない（record.css）。

type Piece = { x: number; delay: number; drift: number; spin: number; tone: string; round: boolean }

/** 紙吹雪 24 片。位置・遅れ・流れ・回転は番号から決まる（乱数を使わない）。横は帯の 4〜92 %、流れは ±20 px */
const CONFETTI: Piece[] = Array.from({ length: 24 }, (_, i) => ({
  x: 4 + Math.round(((i * 0.618034) % 1) * 880) / 10,
  delay: 450 + (i % 6) * 90 + Math.floor(i / 6) * 40,
  drift: ((i * 37) % 11) - 5,
  spin: (i % 2 === 0 ? 1 : -1) * (200 + ((i * 53) % 320)),
  tone: ['spruce', 'safe', 'deep'][i % 3] ?? 'spruce',
  round: i % 4 === 0,
}))

function pieceStyle(p: Piece): CSSProperties {
  return {
    '--confetti-x': `${String(p.x)}%`,
    '--confetti-delay': `${String(p.delay)}ms`,
    '--confetti-drift': `${String(p.drift * 4)}px`,
    '--confetti-spin': `${String(p.spin)}deg`,
  } as CSSProperties
}

export function ClearBanner({
  day,
  lang,
  onShown,
}: {
  day: number
  lang: Lang
  onShown: (el: HTMLElement | null) => void
}) {
  return (
    <div className="record-clear">
      <div className="record-clear__confetti" aria-hidden="true">
        {CONFETTI.map((p, i) => (
          <span
            key={i}
            className={`record-confetti record-confetti--${p.tone}${p.round ? ' record-confetti--round' : ''}`}
            style={pieceStyle(p)}
          />
        ))}
      </div>
      <svg className="record-clear__mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <circle className="record-clear__disc" cx="32" cy="32" r="28" />
        <circle className="record-clear__ring" cx="32" cy="32" r="28" pathLength={1} />
        <path className="record-clear__check" d="M19 33 L28 42 L45 23" pathLength={1} />
      </svg>
      {/* フォーカスは「クリア」と説明の塊に移す（読み上げが両方を読む） */}
      <div className="record-clear__text" tabIndex={-1} ref={onShown}>
        <p className="record-clear__title">{RECORD_CLEAR_TEXT.clear[lang]}</p>
        <p className="record-clear__lead">{clearLead(lang, day)}</p>
      </div>
    </div>
  )
}
