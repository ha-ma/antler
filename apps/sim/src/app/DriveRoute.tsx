import { lazy, Suspense, useCallback } from 'react'
import { useNavigate } from 'react-router'
import type { DriveResult } from '@/features/drive'
import { recordHref, toDriveRun, useSaveRun } from '@/features/record'

// /drive の運転の終わり → 走行の記録（record R11、drive-link R8）。drive と record をつなぐのは app 層だけ。
// - 旅の場面の衝突・完走で run を残す（見本の場面は旅が無いので残さない）
// - 完走して残せたら A-7（/t/:id）へ（A5-6）。衝突は終了の帯のまま（A-6 は loss の feature）
// - この端末に所有者トークンが無ければ送らず、移らない（その運転の結果は終了の帯に出ている）
// /drive は three・R3F を含むので遅延読込にする（ほかの画面の初回読込に入れない）。

const DriveScreen = lazy(() => import('@/features/drive').then((m) => ({ default: m.DriveScreen })))

export function DriveRoute() {
  const { mutate: saveRun } = useSaveRun()
  const navigate = useNavigate()
  const onFinish = useCallback(
    (result: DriveResult) => {
      if (result.source !== 'trip') return
      saveRun(
        { tripId: result.tripId, run: toDriveRun(result) },
        {
          onSuccess: (saved) => {
            if (saved.status !== 'not-owner' && result.outcome === 'completed') {
              void navigate(recordHref(result.tripId))
            }
          },
        },
      )
    },
    [saveRun, navigate],
  )
  return (
    <Suspense fallback={null}>
      <DriveScreen onFinish={onFinish} />
    </Suspense>
  )
}
