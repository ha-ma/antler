import { useEffect, useState } from 'react'

/** 点滅の半周期。1 Hz（1 秒に 1 周期）を超えない（ch5 アクセシビリティ、functional.md R4）。 */
export const BLINK_HALF_PERIOD_MS = 500

/**
 * active の間、BLINK_HALF_PERIOD_MS ごとに on / off を切り替える。
 * CSS アニメーションにしないのは、アプリ側の prefers-reduced-motion の全体指定で止まらないようにするため
 * （danger の点滅は安全上の通知。UC-4b）。
 */
export function useBlink(active: boolean): boolean {
  const [on, setOn] = useState(true)
  useEffect(() => {
    if (!active) return undefined
    const id = setInterval(() => {
      setOn((v) => !v)
    }, BLINK_HALF_PERIOD_MS)
    return () => {
      clearInterval(id)
      setOn(true)
    }
  }, [active])
  return active ? on : false
}
