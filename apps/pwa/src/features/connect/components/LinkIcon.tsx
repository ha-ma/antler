import type { LinkStatus } from '../lib/edge-client'

/** 接続状況のアイコン（インライン SVG の stroke）。色だけに頼らず形で分ける。隣に文言があるので装飾。 */
export function LinkIcon({ status }: { status: LinkStatus }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-link-icon={status}
    >
      <circle cx="12" cy="12" r="9" />
      {status === 'open' && <path d="M8 12.5l3 3 5-6" />}
      {status === 'connecting' && <path d="M8 12h.01M12 12h.01M16 12h.01" />}
      {status === 'closed' && <path d="M6 6l12 12" />}
    </svg>
  )
}
