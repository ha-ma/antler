import { Navigate, type RouteObject } from 'react-router'
import { BriefPage } from '@/features/brief-map'
import { PlanPage } from '@/features/plan-trip'
import { RecordPage } from '@/features/record'
import { StopScenesPage } from '@/features/stop-events'
import { DriveRoute } from './DriveRoute'

// /drive（A-3・A-5）は three・R3F を含むので遅延読込にする（DriveRoute の中。ほかの画面の初回読込に入れない）。
// A-2 は /drive?trip={id}&day={n}(&alert=off) で旅程を渡す（drive-link）。trip が無ければ開発用の見本の場面。
// 運転の終わりは DriveRoute が走行の記録を残し、完走なら A-7（/t/:id）へ移る（record R11）。

/** 画面のルート（docs/design/README.md の対応表）。`/` は A-1 へ。 */
export const routes: RouteObject[] = [
  { path: '/', element: <Navigate to="/plan" replace /> },
  { path: '/plan', element: <PlanPage /> },
  { path: '/trip/:id/brief', element: <BriefPage /> },
  { path: '/t/:id', element: <RecordPage /> },
  { path: '/drive', element: <DriveRoute /> },
  // A-4 の確認用（stop-events。運転への組み込みは drive-link）
  { path: '/trip/:id/day/:n/stops', element: <StopScenesPage /> },
  { path: '*', element: <Navigate to="/plan" replace /> },
]
