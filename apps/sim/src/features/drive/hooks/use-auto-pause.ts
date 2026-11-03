import { useEffect } from 'react'
import type { DriveEngine } from '../domain/engine'

/** タブが隠れたら一時停止する（R4。戻っても自動では再開しない） */
export function useAutoPause(engine: DriveEngine): void {
  // eslint-disable-next-line no-restricted-syntax -- document の visibilitychange の購読（外部イベント）
  useEffect(() => {
    const onChange = () => {
      if (document.visibilityState === 'hidden') engine.setPaused(true)
    }
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [engine])
}
