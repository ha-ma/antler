import { lazy, Suspense } from 'react'
import { Navigate, type RouteObject } from 'react-router'
import { BriefPage } from '@/features/brief-map'
import { PlanPage } from '@/features/plan-trip'
import { StopScenesPage } from '@/features/stop-events'

// /drive（A-3・A-5）は three・R3F を含むので遅延読込にする（ほかの画面の初回読込に入れない）。
// A-2 は /drive?trip={id}&day={n}(&alert=off) で旅程を渡す（drive-link）。trip が無ければ開発用の見本の場面。
const DriveScreen = lazy(() => import('@/features/drive').then((m) => ({ default: m.DriveScreen })))

/** 画面のルート（docs/design/README.md の対応表）。`/` は A-1 へ。 */
export const routes: RouteObject[] = [
  { path: '/', element: <Navigate to="/plan" replace /> },
  { path: '/plan', element: <PlanPage /> },
  { path: '/trip/:id/brief', element: <BriefPage /> },
  {
    path: '/drive',
    element: (
      <Suspense fallback={null}>
        <DriveScreen />
      </Suspense>
    ),
  },
  // A-4 の確認用（stop-events。運転への組み込みは drive-link）
  { path: '/trip/:id/day/:n/stops', element: <StopScenesPage /> },
  { path: '*', element: <Navigate to="/plan" replace /> },
]
