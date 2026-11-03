/**
 * 鹿のピクトグラム（自作の stroke SVG。functional.md R13、ch8 規約 7）。
 * zone と danger、A と B のすべての画面でこの 1 つを使う。色は currentColor（状態の on-alert-* を引き継ぐ）。
 */
export function DeerPictogram({ size = 96 }: { size?: number }) {
  return (
    <svg
      data-icon="deer"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth={3.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {/* 角 */}
      <path d="M40 14 L36 6 M38 10 L34 9 M44 14 L48 6 M46 10 L50 9" />
      {/* 頭と耳 */}
      <path d="M38 16 L42 15 L46 16 L44 22 L40 22 Z M37 17 L33 15 M47 17 L51 15" />
      {/* 首と胴 */}
      <path d="M40 22 L36 30 L14 30 Q10 31 10 36 L12 40 L36 40 L40 34 Z" />
      {/* 尾 */}
      <path d="M10 33 L7 31" />
      {/* 脚 */}
      <path d="M14 40 L12 54 M20 40 L21 54 M32 40 L30 54 M37 40 L39 54" />
    </svg>
  )
}
