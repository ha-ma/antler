import { useFrame } from '@react-three/fiber'
import { useRef, useState } from 'react'
import { INITIAL_QUALITY, dprOf, lowFpsFor, stepQuality } from '../domain/quality'
import { PRIORITY } from './frame-state'

// 描画の解像度（DPR）を自動で下げる段（performance R4）。最初の 2 秒の窓は判定せず、その後、遅い状態
// （2 秒の窓で PC は 45 fps 未満、スマホ＝粗いポインタは 27 fps 未満）が 2 窓続いたら DPR を 1.5 → 1.25 → 1 と
// 1 段ずつ下げる。下げたら戻さない。落とすのは画素の細かさだけで、描くもの（木・鹿・雪や雨・ミラー）は変えない。
// DPR は Canvas の prop で持つ（DriveCanvas の state）。R3F は Canvas を描き直すたびに prop の dpr と違えば
// 戻すので、ここで setDpr を直接呼ぶと一時停止などで 1.5 に戻ってしまう（component-guard W-3）。

type Props = {
  /** 段が変わったときに新しい DPR を渡す */
  onDpr: (dpr: number) => void
}

export function AdaptiveDpr({ onDpr }: Props) {
  const quality = useRef(INITIAL_QUALITY)
  // 端末の種類は場面を作るときに 1 回だけ見る
  const [lowFps] = useState(() =>
    lowFpsFor(window.matchMedia?.('(pointer: coarse)').matches ?? false),
  )
  useFrame((_, delta) => {
    const prev = quality.current
    const next = stepQuality(prev, delta * 1000, lowFps)
    quality.current = next
    if (next.step !== prev.step) onDpr(dprOf(next, window.devicePixelRatio))
  }, PRIORITY.simulate - 1)
  return null
}
