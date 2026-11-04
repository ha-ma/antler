import { lazy, Suspense } from 'react'
import { useNavigate } from 'react-router'
import type { DriveResult } from '@/features/drive'
import { lossHref, lossReportFromDrive } from '@/features/loss'

// /drive（A-3・A-5）は three・R3F を含むので遅延読込にする（ほかの画面の初回読込に入れない）。
// A-2 は /drive?trip={id}&day={n}(&alert=off) で旅程を渡す（drive-link）。trip が無ければ開発用の見本の場面。
const DriveScreen = lazy(() => import('@/features/drive').then((m) => ({ default: m.DriveScreen })))

/**
 * 運転の画面と、走り終えたあとの行き先（A5-6）。旅の場面で鹿と衝突したら A-6（`/loss/:id?…`）へ移る。
 * 完走（A-7）は record の担当で、ここでは移らない。
 */
export function DriveRoute() {
  const navigate = useNavigate()
  const onFinish = (result: DriveResult) => {
    const collision = lossReportFromDrive(result)
    if (collision) void navigate(lossHref(collision))
  }
  return (
    <Suspense fallback={null}>
      <DriveScreen onFinish={onFinish} />
    </Suspense>
  )
}
