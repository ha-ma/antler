import type { DriveInput } from '../types'

// 左の円（docs/specs/mobile-landscape/functional.md R3、A3-3）。ドラッグのずれ → 運転の入力。
// 入力は今までどおり押した・離した（boolean）。円の中心からのずれ（半径で割った -1〜1）が遊びを越えたら押す。

/** 遊び（半径の 3 割より内側は何も押さない） */
export const STICK_DEAD_ZONE = 0.3

export type StickInput = Pick<DriveInput, 'left' | 'right' | 'throttle' | 'back'>

/** x: 左 -1 〜 右 1、y: 上 -1 〜 下 1（画面の座標と同じ向き） */
export function stickInput(x: number, y: number): StickInput {
  return {
    left: x < -STICK_DEAD_ZONE,
    right: x > STICK_DEAD_ZONE,
    throttle: y < -STICK_DEAD_ZONE,
    back: y > STICK_DEAD_ZONE,
  }
}

/** 指の位置 → 円の中のずれ（半径で割る。円の外は縁に丸める） */
export function stickOffset(
  pointerX: number,
  pointerY: number,
  centerX: number,
  centerY: number,
  radius: number,
): { x: number; y: number } {
  if (!(radius > 0)) return { x: 0, y: 0 }
  const x = (pointerX - centerX) / radius
  const y = (pointerY - centerY) / radius
  const length = Math.hypot(x, y)
  if (length <= 1) return { x, y }
  return { x: x / length, y: y / length }
}
