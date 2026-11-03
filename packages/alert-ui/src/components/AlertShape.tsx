import type { ReactNode } from 'react'
import type { AlertStateName } from '../i18n/i18n'

// 3 状態の形（緑＝円、琥珀＝三角、赤＝八角）。色だけで区別させない（ch5・docs/design/README.md 原則 2）。
// 線と中のアイコンは currentColor（on-alert-*）。

const OUTLINE: Record<AlertStateName, { shape: string; node: ReactNode }> = {
  safe: { shape: 'circle', node: <circle cx="50" cy="50" r="44" /> },
  zone: { shape: 'triangle', node: <path d="M50 6 L94 88 L6 88 Z" /> },
  danger: {
    shape: 'octagon',
    node: <path d="M31.8 6 L68.2 6 L94 31.8 L94 68.2 L68.2 94 L31.8 94 L6 68.2 L6 31.8 Z" />,
  },
}

export function AlertShape({
  state,
  size,
  children,
}: {
  state: AlertStateName
  size: number
  children?: ReactNode
}) {
  const { shape, node } = OUTLINE[state]
  return (
    <span className="antler-alert__shape" style={{ width: size, height: size }}>
      <svg
        data-shape={shape}
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        stroke="currentColor"
        strokeWidth={6}
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {node}
        {state === 'safe' && (
          <path data-icon="check" d="M30 52 L44 66 L72 36" strokeLinecap="round" />
        )}
      </svg>
      {children && <span className="antler-alert__shape-icon">{children}</span>}
    </span>
  )
}
