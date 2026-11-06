import { useEffect, useLayoutEffect, useRef } from 'react'
import { isTap } from '../domain/spot'

/** 画面の上の位置（-1〜1。x は右、y は上が正。three.js の Raycaster.setFromCamera に渡す形） */
export type Ndc = { x: number; y: number }

/**
 * 3D の画面（canvas）のタップ・クリックを受ける（drive-crash-spot R4・UC-4f）。押してから 8 px を超えて動いたら
 * 視線のドラッグなので数えない。指ごと（pointerId ごと）に測る。マウスは左ボタンだけ。
 * onTap には画面の上の位置を渡す（鹿を選ぶのは呼ぶ側）
 */
export function useDeerTap(element: HTMLElement | null, onTap: (ndc: Ndc) => void): void {
  const latest = useRef(onTap)
  useLayoutEffect(() => {
    latest.current = onTap
  })
  // eslint-disable-next-line no-restricted-syntax -- canvas の pointer イベントの購読（外部の DOM）
  useEffect(() => {
    if (!element) return undefined
    const downs = new Map<number, { x: number; y: number }>()
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      downs.set(e.pointerId, { x: e.clientX, y: e.clientY })
    }
    const onUp = (e: PointerEvent) => {
      const down = downs.get(e.pointerId)
      downs.delete(e.pointerId)
      if (!down || !isTap(down, { x: e.clientX, y: e.clientY })) return
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      latest.current({
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
      })
    }
    const onCancel = (e: PointerEvent) => downs.delete(e.pointerId)
    element.addEventListener('pointerdown', onDown)
    element.addEventListener('pointerup', onUp)
    element.addEventListener('pointercancel', onCancel)
    return () => {
      element.removeEventListener('pointerdown', onDown)
      element.removeEventListener('pointerup', onUp)
      element.removeEventListener('pointercancel', onCancel)
    }
  }, [element])
}
