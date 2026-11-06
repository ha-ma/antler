import { useCallback, useSyncExternalStore } from 'react'

// メディアクエリ（指で操る端末か・縦か。docs/specs/mobile-landscape/functional.md）を購読する。
// 走っている途中に変わったらその場で描き直す。matchMedia の無い環境（テストの jsdom など）では false。

/** 指で触れるポインタが 1 つでもある（円・ジャイロを出す） */
export const ANY_TOUCH_QUERY = '(any-pointer: coarse)'
/** 主のポインタが指（キーの説明を隠す・操作の説明を指の版にする） */
export const PRIMARY_TOUCH_QUERY = '(pointer: coarse)'
/** 主のポインタが指で縦（ローテーションの案内） */
export const PORTRAIT_TOUCH_QUERY = '(pointer: coarse) and (orientation: portrait)'

function mediaList(query: string): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia(query)
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = mediaList(query)
      if (!list) return () => undefined
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => mediaList(query)?.matches ?? false,
    () => false,
  )
}
