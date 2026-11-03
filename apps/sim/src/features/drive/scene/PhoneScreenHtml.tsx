import { Html } from '@react-three/drei'
import type { ReactNode } from 'react'
import { PHONE_SIZE_M } from './cabin-models'

// 車内のスマホの画面（A5-1）。メインが渡す AlertState compact を、drei の Html（transform）でスマホの板に貼る。
// HUD ではない（車内の物なので視線と一緒に動く。R10）。HUD の DOM より下に出す（z-index 0〜1、ポインタを奪わない）。
// 注意: Html は別の React root に描くので、メインの Provider の文脈は届かない（phone は props だけで描けるものを渡す）。

/** 画面の大きさ（CSS px）。この箱の中に phone を描く */
export const PHONE_SCREEN_PX: readonly [number, number] = [180, 360]
/** drei の Html transform は 1 px = distanceFactor / 400（m）。画面の幅を PHONE_SIZE_M に合わせる */
const DISTANCE_FACTOR = (PHONE_SIZE_M[0] / PHONE_SCREEN_PX[0]) * 400

type Props = { children: ReactNode }

export function PhoneScreenHtml({ children }: Props) {
  return (
    <Html
      transform
      distanceFactor={DISTANCE_FACTOR}
      position={[0, 0, 0.0006]}
      zIndexRange={[1, 0]}
      pointerEvents="none"
    >
      <div
        style={{
          width: PHONE_SCREEN_PX[0],
          height: PHONE_SCREEN_PX[1],
          overflow: 'hidden',
          borderRadius: 14,
          pointerEvents: 'none',
        }}
      >
        {children}
      </div>
    </Html>
  )
}
