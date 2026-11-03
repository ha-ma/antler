import type { Side } from '@antler/schema'

// danger の方向矢印。side が無い（壊れたフラグ）ときは前方（上向き）を出す（functional.md R3）。

const PATHS: Record<Side | 'front', string> = {
  L: 'M40 12 L14 32 L40 52 M14 32 L54 32',
  R: 'M24 12 L50 32 L24 52 M50 32 L10 32',
  front: 'M12 38 L32 14 L52 38 M32 14 L32 54',
}

export function DirectionArrow({ side, size }: { side: Side | undefined; size: number }) {
  const key = side ?? 'front'
  return (
    <svg
      data-arrow={key}
      className="antler-alert__arrow"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth={7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[key]} />
    </svg>
  )
}
