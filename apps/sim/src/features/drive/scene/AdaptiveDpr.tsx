import { useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'
import { INITIAL_QUALITY, dprOf, stepQuality } from '../domain/quality'
import { PRIORITY } from './frame-state'

// 描画の解像度（DPR）を自動で下げる段（performance R4）。遅い状態（2 秒の窓で 45 fps 未満）が 2 窓続いたら
// DPR を 1.5 → 1.25 → 1 と 1 段ずつ下げる。下げたら戻さない。落とすのは画素の細かさだけで、描くもの
// （木・鹿・雪や雨・ミラー）は変えない。

export function AdaptiveDpr() {
  const setDpr = useThree((s) => s.setDpr)
  const quality = useRef(INITIAL_QUALITY)
  useFrame((_, delta) => {
    const prev = quality.current
    const next = stepQuality(prev, delta * 1000)
    quality.current = next
    if (next.step !== prev.step) setDpr(dprOf(next, window.devicePixelRatio))
  }, PRIORITY.simulate - 1)
  return null
}
