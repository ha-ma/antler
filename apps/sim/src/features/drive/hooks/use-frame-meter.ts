import { useMemo, useSyncExternalStore } from 'react'
import type { DriveEngine } from '../domain/engine'
import type { FrameSummary } from '../domain/frame-stats'

// 開発用の fps の表示（performance R2）が読む値。エンジンの要約は最大 7,200 個の並べ替えなので、
// 毎フレームではなく 0.5 秒ごとに取り直す（タイマーの購読なので useSyncExternalStore で受ける）。

/** 取り直す間隔（ms） */
export const FRAME_METER_MS = 500

/** URL のクエリに fps=1 があるか */
export function isFrameMeterOn(search: string): boolean {
  return new URLSearchParams(search).get('fps') === '1'
}

function meterStore(read: () => FrameSummary | null) {
  let value = read()
  return {
    subscribe(onChange: () => void): () => void {
      const id = setInterval(() => {
        value = read()
        onChange()
      }, FRAME_METER_MS)
      return () => clearInterval(id)
    },
    get: (): FrameSummary | null => value,
  }
}

/** エンジンのフレームの要約を 0.5 秒ごとに返す */
export function useFrameMeter(engine: DriveEngine): FrameSummary | null {
  const store = useMemo(() => meterStore(() => engine.frameSummary()), [engine])
  return useSyncExternalStore(store.subscribe, store.get)
}
