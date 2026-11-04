import { lazy, Suspense } from 'react'
import { Navigate, type RouteObject } from 'react-router'
import { BriefPage } from '@/features/brief-map'
import { LossPage } from '@/features/loss'
import { PlanPage } from '@/features/plan-trip'

// /drive（A-3・A-5）は three・R3F を含むので遅延読込にする（ほかの画面の初回読込に入れない）。
// いまは固定の場面で走る。A-2 は /drive?trip={id}&day={n}(&alert=off) で旅程を渡す（drive が読むのは後の cycle）。
const DrivePage = lazy(() => import('@/features/drive').then((m) => ({ default: m.DrivePage })))

/** 画面のルート（docs/design/README.md の対応表）。`/` は A-1 へ。 */
export const routes: RouteObject[] = [
  { path: '/', element: <Navigate to="/plan" replace /> },
  { path: '/plan', element: <PlanPage /> },
  { path: '/trip/:id/brief', element: <BriefPage /> },
  { path: '/loss/:id', element: <LossPage /> },
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
