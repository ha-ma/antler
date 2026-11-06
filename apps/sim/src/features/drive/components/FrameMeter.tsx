import { useState, type CSSProperties } from 'react'
import type { DriveEngine } from '../domain/engine'
import { formatFrameMeter } from '../domain/frame-stats'
import { isFrameMeterOn, useFrameMeter } from '../hooks/use-frame-meter'

// 開発用の fps の表示（performance R2）。/drive?fps=1 のときだけ、画面の左下に運転中の rAF の要約
// （fps の中央値・5 パーセンタイル・落ちたフレームの数・数えたフレーム）を数字だけで出す。
// 計測の道具なので読み上げない・操作しない（aria-hidden、pointer-events: none）。配置は drive.css に入れず
// この中で完結させる（HUD の配置に影響させない）。

const STYLE: CSSProperties = {
  position: 'absolute',
  left: 'var(--space-2)',
  bottom: 'var(--space-2)',
  zIndex: 50,
  margin: 0,
  padding: 'var(--space-1) var(--space-2)',
  borderRadius: 'var(--radius-s)',
  background: 'var(--surface-sunken)',
  color: 'var(--ink)',
  font: '500 12px/16px var(--font-mono)',
  whiteSpace: 'pre',
  pointerEvents: 'none',
}

export function FrameMeter({ engine }: { engine: DriveEngine }) {
  // URL は場面を作るときに 1 回読む（drive の他のクエリと同じ）
  const [on] = useState(() => isFrameMeterOn(window.location.search))
  return on ? <FrameMeterReadout engine={engine} /> : null
}

function FrameMeterReadout({ engine }: { engine: DriveEngine }) {
  const summary = useFrameMeter(engine)
  return (
    <pre data-testid="frame-meter" aria-hidden="true" style={STYLE}>
      {formatFrameMeter(summary)}
    </pre>
  )
}
