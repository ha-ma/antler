import type { MouseEvent } from 'react'

/**
 * マウスで押した HUD のボタンからはフォーカスを外す（そのあとの Space をブレーキにする。component-guard W4）。
 * キーボードで押したとき（detail が 0）はフォーカスを残す（キーボードの利用者がボタンを続けて操作できる）。
 */
export function releaseFocusAfterPointer(e: MouseEvent<HTMLButtonElement>): void {
  if (e.detail > 0) e.currentTarget.blur()
}
