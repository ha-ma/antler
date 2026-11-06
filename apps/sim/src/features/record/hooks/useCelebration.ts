import type { TripRecord } from '@antler/trip'
import { useCallback, useState } from 'react'
import { useLocation } from 'react-router'
import {
  arrivalOf,
  celebrationOf,
  markCelebrated,
  wasCelebrated,
  type Celebration,
} from '../utils/celebration'

// A-7 の「クリア」を出すか（docs/specs/result-screens/functional.md R4）。
// State 設計: 画面だけの状態（useState）。最初の描画で 1 回だけ決め、そのあとの再取得では足さない・消さない。
// 出したら、その履歴を sessionStorage に覚える（戻る・再読み込みで繰り返さない）。

export function useCelebration(record: TripRecord): {
  celebration: Celebration | null
  /** 「クリア」の要素の ref。出たときにフォーカスを移し、この履歴で出したと覚える */
  onShown: (el: HTMLElement | null) => void
} {
  const location = useLocation()
  const historyKey = `${location.key}:${location.pathname}`
  const [celebration] = useState(() =>
    wasCelebrated(historyKey) ? null : celebrationOf(record, arrivalOf(location.state)),
  )
  const onShown = useCallback(
    (el: HTMLElement | null) => {
      if (!el) return
      el.focus()
      markCelebrated(historyKey)
    },
    [historyKey],
  )
  return { celebration, onShown }
}
