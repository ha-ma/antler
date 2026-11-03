import type { AlertStateName } from '@antler/alert-ui'

// 3 状態の小さな印（色＋形。円・三角・八角。ch5）。色は tokens の CSS 変数。
const SHAPES: Record<AlertStateName, string> = {
  safe: 'M12 2a10 10 0 1 0 0.001 0Z',
  zone: 'M12 2 L22.5 20.5 H1.5 Z',
  danger: 'M8 1.5 H16 L22.5 8 V16 L16 22.5 H8 L1.5 16 V8 Z',
}

export function StateMark({ state, size = 24 }: { state: AlertStateName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={SHAPES[state]} fill={`var(--alert-${state})`} />
    </svg>
  )
}
