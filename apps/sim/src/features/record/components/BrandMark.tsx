// ブランドの印（UI キャンバス v2 の A7_Record と同じ形。インライン SVG・stroke）

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
