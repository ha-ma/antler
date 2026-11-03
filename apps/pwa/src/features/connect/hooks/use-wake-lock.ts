import { useEffect, useState } from 'react'
import {
  acquireWakeLock,
  lockPortrait,
  type WakeLockDeps,
  type WakeLockSentinelLike,
} from '../lib/wake-lock'

/** 走行中の画面の常時点灯と縦向きの固定（B4-6）。取れなければ failed。画面が戻ったら取り直す。 */
export function useWakeLock(deps: WakeLockDeps): { failed: boolean } {
  const [failed, setFailed] = useState(false)

  // 画面（Wake Lock）という外部の資源との同期
  // eslint-disable-next-line no-restricted-syntax -- 購読と資源の解放
  useEffect(() => {
    let sentinel: WakeLockSentinelLike | null = null
    let cancelled = false
    const take = async () => {
      const got = await acquireWakeLock(deps)
      if (cancelled) {
        void got?.release()
        return
      }
      sentinel = got
      setFailed(got === null)
    }
    void take()
    void lockPortrait(deps)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void take()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      void sentinel?.release()
    }
  }, [deps])

  return { failed }
}
