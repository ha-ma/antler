type Props = { selected: boolean }

/** カード右上の丸バッジ。選択済みはチェック、未選択は＋（インライン SVG。stroke）。 */
export function SelectBadge({ selected }: Props) {
  return (
    <svg
      className={selected ? 'plan-badge plan-badge--selected' : 'plan-badge'}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="plan-badge__disc" cx="12" cy="12" r="11" />
      {selected ? (
        <path className="plan-badge__mark" d="M7 12.5 L10.5 16 L17 8.5" />
      ) : (
        <path className="plan-badge__mark" d="M12 7 V17 M7 12 H17" />
      )}
    </svg>
  )
}
