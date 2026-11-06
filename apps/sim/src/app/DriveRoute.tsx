import { useCallback } from 'react'
import { useNavigate } from 'react-router'
import { DriveScreen, type DriveResult } from '@/features/drive'
import { lossHref, lossReportFromDrive } from '@/features/loss'
import { recordHref, toDriveRun, useSaveRun } from '@/features/record'

// /drive の運転の終わり（A5-6）。drive と record・loss をつなぐのは app 層だけ。
// - 旅の場面の衝突・完走で run を残す（record R11。見本の場面は旅が無いので残さない）
// - 衝突したら A-6（/loss/:id?…）へすぐ移る（loss R1。run の保存の結果は待たない。保存は裏で続く）
// - 完走して残せたら A-7（/t/:id）へ（record R11）。この端末に所有者トークンが無ければ送らず、移らない
// このファイル自体をルートの lazy で読む（routes.tsx）ので、drive の barrel はここで静的に読む（読み込みの段を
// 1 つ減らす。performance R5）。three・R3F は drive の中でもう一段遅らせている（scene/load-drive-canvas.ts）。

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
      const collision = lossReportFromDrive(result)
      if (collision) void navigate(lossHref(collision))
    },
    [saveRun, navigate],
  )
  return <DriveScreen onFinish={onFinish} />
}
