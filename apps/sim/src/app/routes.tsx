import { lazy, Suspense } from 'react'
import { Navigate, type RouteObject } from 'react-router'
import { PlanPage, TripBriefPlaceholder } from '@/features/plan-trip'

// /drive（A-3・A-5）は three・R3F を含むので遅延読込にする（ほかの画面の初回読込に入れない）。
// いまは固定の場面で走る。brief-map（A-2）ができたら /trip/:id/drive などに旅程を渡す。
const DrivePage = lazy(() => import('@/features/drive').then((m) => ({ default: m.DrivePage })))

/** 画面のルート（docs/design/README.md の対応表）。`/` は A-1 へ。 */
export const routes: RouteObject[] = [
  { path: '/', element: <Navigate to="/plan" replace /> },
  { path: '/plan', element: <PlanPage /> },
  { path: '/trip/:id/brief', element: <TripBriefPlaceholder /> },
  {
    path: '/drive',
    element: (
      <Suspense fallback={null}>
        <DrivePage />
      </Suspense>
    ),
  },
  { path: '*', element: <Navigate to="/plan" replace /> },
]
