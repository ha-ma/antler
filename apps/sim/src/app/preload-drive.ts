// A-2 の間に運転のチャンク（drive と 3D）を先読みする（performance R5、ch6「アセットは A-2 中にプリロード」）。
// drive と record・loss をつなぐのと同じく、feature をまたぐ先読みは app 層だけで行う（brief-map は drive を知らない）。

let pending: Promise<void> | null = null

/**
 * /drive のルート（DriveRoute）・drive の barrel・3D のチャンクを読む。2 回目からは同じ Promise。
 * 失敗したら次に呼ばれたときに読み直す（運転の画面に入ったときにも普通に読むので、ここでは握りつぶす）
 */
export function preloadDrive(): Promise<void> {
  // DriveRoute は drive の barrel を静的に読む（同じチャンクの流れ）。3D はその先でもう一段
  pending ??= Promise.all([
    import('./DriveRoute'),
    import('@/features/drive').then((m) => m.preloadDriveScene()),
  ]).then(
    () => undefined,
    () => {
      pending = null
    },
  )
  return pending
}

type IdleWindow = Pick<Window, 'setTimeout'> & {
  requestIdleCallback?: (run: () => void, options?: { timeout: number }) => number
  navigator?: Navigator & { connection?: { saveData?: boolean } }
}

/** 先読みを始めるまでの最長の待ち（ms）。A-2 の地図・行程の読み込みを先に通す */
export const PRELOAD_IDLE_TIMEOUT_MS = 2000

/**
 * ブラウザが空いたら（requestIdleCallback が無ければ 1 秒後に）先読みを始める。
 * データ節約（Save-Data）の端末では先読みしない（運転の画面に入ったときに読む。spec-adversary 9）
 */
export function schedulePreloadDrive(win: IdleWindow = window): void {
  if (win.navigator?.connection?.saveData === true) return
  const run = () => void preloadDrive()
  if (typeof win.requestIdleCallback === 'function') {
    win.requestIdleCallback(run, { timeout: PRELOAD_IDLE_TIMEOUT_MS })
  } else {
    win.setTimeout(run, 1000)
  }
}
