// 3D（three・R3F、gzip 約 250 KB）のチャンクを読む口を 1 つにまとめる（performance R5）。
// DrivePage の遅延読込と、A-2 の間の先読み（app 層の preloadDrive）が同じ import を使うので、
// 先読みが済んでいれば「出発」の前にもう届いている。

export const loadDriveCanvas = () => import('./DriveCanvas')

/** 3D のチャンクを先に読んでおく（失敗しても運転の画面に入ったときに読み直すので握りつぶす） */
export function preloadDriveScene(): Promise<void> {
  return loadDriveCanvas().then(
    () => undefined,
    () => undefined,
  )
}
