import { useState } from 'react'
import type { DriveEngine } from '../domain/engine'
import { isFrameMeterOn } from '../hooks/use-frame-meter'
import { FrameMeterReadout } from './FrameMeterReadout'

// 開発用の fps の表示（performance R2）。/drive?fps=1 のときだけ、画面の左下に運転中の rAF の要約
// （fps の中央値・5 パーセンタイル・落ちたフレームの数・数えたフレーム）を数字だけで出す。
// 表示しないときはタイマーも要約の計算も走らせない（中身の FrameMeterReadout を描かない）。

export function FrameMeter({ engine }: { engine: DriveEngine }) {
  // URL は場面を作るときに 1 回読む（drive の他のクエリと同じ）
  const [on] = useState(() => isFrameMeterOn(window.location.search))
  return on ? <FrameMeterReadout engine={engine} /> : null
}
