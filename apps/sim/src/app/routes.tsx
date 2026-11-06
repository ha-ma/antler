import { Navigate, type RouteObject } from 'react-router'
import { PlanPage } from '@/features/plan-trip'
import { schedulePreloadDrive } from './preload-drive'

// 画面は A-1 を除いてルートごとに遅延読込にする（performance R5。初回読込にはその画面のチャンクだけを入れる）。
// /drive（A-3・A-5）は three・R3F を含むので、DriveRoute の中でもう一段 3D だけを遅らせる。
// A-2（/trip/:id/brief）を開いたら、運転のチャンク（drive と 3D）をブラウザが空いたときに先読みする
// （ch6「アセットは A-2 中にプリロード」）。
// A-2 は /drive?trip={id}&day={n}(&alert=off) で旅程を渡す（drive-link）。trip が無ければ開発用の見本の場面。
// 運転の終わりは DriveRoute が走行の記録を残し、衝突なら A-6（/loss/:id）、完走なら A-7（/t/:id）へ移る（loss R1・record R11）。

/** 画面のルート（docs/design/README.md の対応表）。`/` は A-1 へ。 */
export const routes: RouteObject[] = [
  { path: '/', element: <Navigate to="/plan" replace /> },
  // A-1 は入口（`/` と知らないパスの行き先）なので入口のチャンクに入れる。遅延読込にすると、入口の JS を
  // 実行してから A-1 のチャンクを取りに行くので 1 往復（Slow 4G で約 0.56 秒）遅れる
  { path: '/plan', element: <PlanPage /> },
  {
    path: '/trip/:id/brief',
    lazy: () =>
      import('@/features/brief-map').then((m) => {
        schedulePreloadDrive()
        return { Component: m.BriefPage }
      }),
  },
  {
    path: '/loss/:id',
    lazy: () => import('@/features/loss').then((m) => ({ Component: m.LossPage })),
  },
  {
    path: '/t/:id',
    lazy: () => import('@/features/record').then((m) => ({ Component: m.RecordPage })),
  },
  {
    path: '/drive',
    lazy: () => import('./DriveRoute').then((m) => ({ Component: m.DriveRoute })),
  },
  // A-4 の確認用（stop-events。運転への組み込みは drive-link）
  {
    path: '/trip/:id/day/:n/stops',
    lazy: () => import('@/features/stop-events').then((m) => ({ Component: m.StopScenesPage })),
  },
  { path: '*', element: <Navigate to="/plan" replace /> },
]
