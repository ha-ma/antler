import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CRASH_MS } from '../domain/crash'

/**
 * 衝突の演出の計り（drive-crash-spot R3・UC-3c・UC-3d）。crashed が true になってから CRASH_MS（実時間）で
 * onEnd を 1 回だけ呼び、true（終わった）を返す。途中で crashed が false に戻る（もう一度）・アンマウントすると
 * 呼ばない。onEnd の同一性が変わっても計り直さない（最新の onEnd を呼ぶ）。一時停止・タブを隠しても止めない
 */
export function useCrashSequence(crashed: boolean, onEnd: () => void): boolean {
  const [ended, setEnded] = useState(false)
  const latest = useRef(onEnd)
  useLayoutEffect(() => {
    latest.current = onEnd
  })
  // eslint-disable-next-line no-restricted-syntax -- 演出の終わりのタイマー（外部の時計）
  useEffect(() => {
    if (!crashed) return
    const id = window.setTimeout(() => {
      setEnded(true)
      latest.current()
    }, CRASH_MS)
    return () => {
      window.clearTimeout(id)
      setEnded(false)
    }
  }, [crashed])
  return crashed && ended
}
