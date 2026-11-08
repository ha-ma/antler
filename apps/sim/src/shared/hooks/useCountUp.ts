import { useEffect, useRef, useState } from 'react'

// 数え上げの進み（docs/specs/result-countup/functional.md R4・R5）。
// 要素が画面に入ったら（IntersectionObserver の最初の交差）、requestAnimationFrame で 0 → 1 に進める。
// 始まりは「見えたとき」と「mount から notBeforeMs」の遅いほう。1 回の mount で 1 回だけ。
// 動きを減らす設定・IntersectionObserver か requestAnimationFrame の無い環境では、最初から終わった形（null）。
// 時刻は rAF の引数だけで測る（時計を混ぜない）。

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

export const COUNT_UP_DURATION_MS = 1200

function canCountUp(): boolean {
  if (typeof window === 'undefined') return false
  if (typeof window.IntersectionObserver !== 'function') return false
  if (typeof window.requestAnimationFrame !== 'function') return false
  if (typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION_QUERY).matches)
    return false
  return true
}

type Options = {
  /** 数え上げる値があるか（「—」のように数字が無ければ動かさない） */
  enabled: boolean
  /** mount からこれだけ経つまでは始めない（例: A-6 のカードの着地） */
  notBeforeMs?: number | undefined
  durationMs?: number | undefined
}

/**
 * ref を付けた要素の数え上げの進み（ease の前の 0〜1）。終わった・動かさないときは null。
 */
export function useCountUp<T extends Element>({
  enabled,
  notBeforeMs = 0,
  durationMs = COUNT_UP_DURATION_MS,
}: Options) {
  const ref = useRef<T>(null)
  const [progress, setProgress] = useState<number | null>(() =>
    enabled && canCountUp() ? 0 : null,
  )
  const running = progress !== null

  // 購読（IntersectionObserver）とタイマー（requestAnimationFrame）。描画から求まる値ではないので effect に置く。
  // 終わったら（running が false）両方を止め、二度と始めない
  // eslint-disable-next-line no-restricted-syntax -- IntersectionObserver の購読と rAF のタイマー（外部の時計。片づけで止める）
  useEffect(() => {
    const el = ref.current
    if (!running || !el) return
    let frame = 0
    let mountAt: number | null = null
    let startAt: number | null = null
    let seen = false

    const tick = (now: number) => {
      mountAt ??= now
      if (!seen) return
      startAt ??= Math.max(now, mountAt + notBeforeMs)
      const t = (now - startAt) / durationMs
      if (t >= 1) {
        setProgress(null)
        return
      }
      setProgress(Math.max(0, t))
      frame = window.requestAnimationFrame(tick)
    }

    // mount の時刻を rAF の時計で取る
    frame = window.requestAnimationFrame(tick)
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      observer.disconnect()
      seen = true
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(tick)
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frame)
    }
  }, [running, notBeforeMs, durationMs])

  return { ref, progress }
}
