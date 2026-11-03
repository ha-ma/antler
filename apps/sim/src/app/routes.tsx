import { Navigate, type RouteObject } from 'react-router'
import { PlanPage, TripBriefPlaceholder } from '@/features/plan-trip'

/** 画面のルート（docs/design/README.md の対応表）。`/` は A-1 へ。 */
export const routes: RouteObject[] = [
  { path: '/', element: <Navigate to="/plan" replace /> },
  { path: '/plan', element: <PlanPage /> },
  { path: '/trip/:id/brief', element: <TripBriefPlaceholder /> },
  { path: '*', element: <Navigate to="/plan" replace /> },
]
