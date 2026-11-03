import { logger } from '@/shared/utils/logger'

// 画面の常時点灯（B4-6）と回転ロック。取れなくても落ちず、結果だけ返す（取れないときは画面に注記する）。

export type WakeLockSentinelLike = { release(): Promise<void> }
export type WakeLockDeps = {
  wakeLock: { request(type: 'screen'): Promise<WakeLockSentinelLike> } | undefined
  orientation: { lock(o: 'portrait'): Promise<void> } | undefined
}

export function browserWakeLockDeps(): WakeLockDeps {
  const nav = globalThis.navigator as unknown as { wakeLock?: WakeLockDeps['wakeLock'] }
  const screenOrientation = (
    globalThis.screen as unknown as { orientation?: WakeLockDeps['orientation'] } | undefined
  )?.orientation
  return { wakeLock: nav?.wakeLock, orientation: screenOrientation }
}

/** 画面を点けたままにする。取れたら sentinel、取れなければ null。 */
export async function acquireWakeLock(deps: WakeLockDeps): Promise<WakeLockSentinelLike | null> {
  if (!deps.wakeLock) return null
  try {
    return await deps.wakeLock.request('screen')
  } catch {
    logger.warn('wakelock.failed', {})
    return null
  }
}

/** 縦向きに固定してみる。全画面でないと拒否されることが多いので、失敗は記録だけ。 */
export async function lockPortrait(deps: WakeLockDeps): Promise<void> {
  try {
    await deps.orientation?.lock('portrait')
  } catch {
    logger.warn('orientation.failed', {})
  }
}
