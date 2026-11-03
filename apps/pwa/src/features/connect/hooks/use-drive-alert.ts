import { deriveAlertState, type DerivedAlert, type GpsZone } from '@antler/alert-ui'
import { useEffect, useRef, useState } from 'react'
import type { EdgeSnapshot } from '../lib/edge-client'

function same(a: DerivedAlert | null, b: DerivedAlert): boolean {
  return (
    a !== null &&
    a.state === b.state &&
    a.distance === b.distance &&
    a.side === b.side &&
    a.inZone === b.inZone
  )
}

/**
 * 表示する 3 状態。決めるのは deriveAlertState（アプリ側で決めない）。
 * now が進むたびに計算し直すので、フラグが届かなくなっても 5 秒で赤が解ける。
 */
export function useDriveAlert(snapshot: EdgeSnapshot, now: number, gps: GpsZone): DerivedAlert {
  const [previous, setPrevious] = useState<DerivedAlert | null>(null)
  const next = deriveAlertState({
    flag: snapshot.flag,
    flagReceivedAt: snapshot.flagReceivedAt,
    gps,
    now,
    // 位置が使えないあいだは、前の状態（緑や距離）を持ち越さず、起動直後と同じ琥珀に倒す。
    // 緑のまま測位が途絶えて鹿ゾーンに入る見逃しを防ぐ（pwa-drive R4）
    previous: gps.status === 'unknown' ? null : previous,
  })
  if (!same(previous, next)) setPrevious(next)
  return next
}

/** danger を表示し始めたとき 1 回だけ onShown を呼ぶ。danger の間は呼ばない。解けたらまた数える。 */
export function useAckOnDanger(state: DerivedAlert['state'], onShown: () => void): void {
  const acked = useRef(false)
  // eslint-disable-next-line no-restricted-syntax -- 描画のあとに車載へ返す副作用（外部との同期）
  useEffect(() => {
    if (state !== 'danger') {
      acked.current = false
      return
    }
    if (acked.current) return
    acked.current = true
    onShown()
  }, [state, onShown])
}
