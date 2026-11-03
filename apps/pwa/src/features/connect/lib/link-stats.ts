import { RECEIVE_WINDOW_MS } from './edge-client'

/** 直近 5 秒に読めたフラグの 1 秒あたりの数。受信が無ければ undefined（表示は「--」）。 */
export function receiveRate(receivedAt: readonly number[], now: number): number | undefined {
  const count = receivedAt.filter((t) => now - t <= RECEIVE_WINDOW_MS && t <= now).length
  if (count === 0) return undefined
  return count / (RECEIVE_WINDOW_MS / 1000)
}
