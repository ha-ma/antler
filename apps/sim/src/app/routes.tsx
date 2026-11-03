import { Navigate, type RouteObject } from 'react-router'
import { BriefPage } from '@/features/brief-map'
import { PlanPage } from '@/features/plan-trip'

/** 画面のルート（docs/design/README.md の対応表）。`/` は A-1 へ。 */
export const routes: RouteObject[] = [
  { path: '/', element: <Navigate to="/plan" replace /> },
  { path: '/plan', element: <PlanPage /> },
  { path: '/trip/:id/brief', element: <BriefPage /> },
  { path: '*', element: <Navigate to="/plan" replace /> },
]
