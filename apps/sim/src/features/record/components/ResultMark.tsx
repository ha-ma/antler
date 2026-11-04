import type { DayResult } from '@antler/trip'

// しおりの日の結果の印（インライン SVG・stroke。絵文字を使わない。ch8 規約 7）。
// 色だけで分けない: 円とチェック（完走）・✕ の形（衝突）・横線（未走行）。文字の代わりは隣に書く。

export function ResultMark({ result }: { result: DayResult }) {
  if (result === 'completed') {
    return (
      <svg className="record-mark record-mark--completed" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="8.5" fill="none" strokeWidth="2" />
        <path
          d="M6 10.5l3 3 5-6"
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (result === 'collided') {
    return (
      <svg className="record-mark record-mark--collided" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M5 5l10 10M15 5L5 15" fill="none" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg className="record-mark record-mark--none" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5 10h10" fill="none" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/** ブランドの印（デザインの A7_Record と同じ形） */
export function BrandMark() {
  return (
    <svg className="record-brand-mark" viewBox="0 0 28 28" aria-hidden="true">
      <path
        className="record-brand-mark__outer"
        d="M4 22 L14 4 L24 22 Z"
        fill="none"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        className="record-brand-mark__inner"
        d="M9 22 L14 13 L19 22"
        fill="none"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}
