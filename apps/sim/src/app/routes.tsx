import { Navigate, type RouteObject } from 'react-router'
import { BriefPage } from '@/features/brief-map'
import { LossPage } from '@/features/loss'
import { PlanPage } from '@/features/plan-trip'
import { DriveRoute } from './DriveRoute'

/** 画面のルート（docs/design/README.md の対応表）。`/` は A-1 へ。 */
export const routes: RouteObject[] = [
  { path: '/', element: <Navigate to="/plan" replace /> },
  { path: '/plan', element: <PlanPage /> },
  { path: '/trip/:id/brief', element: <BriefPage /> },
  { path: '/loss/:id', element: <LossPage /> },
  // /drive は遅延読込（DriveRoute の中）。衝突したら A-6 へ移る
  { path: '/drive', element: <DriveRoute /> },
  { path: '*', element: <Navigate to="/plan" replace /> },
]
