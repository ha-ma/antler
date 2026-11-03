import { useEffect, useState } from 'react'

/** 1 秒ごとに更新する現在時刻（ms）。フラグが届かなくても赤が解ける時刻を迎えるため。 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  // eslint-disable-next-line no-restricted-syntax -- タイマーの購読
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now())
    }, intervalMs)
    return () => {
      clearInterval(id)
    }
  }, [intervalMs])
  return now
}
