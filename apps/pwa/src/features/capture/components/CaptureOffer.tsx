import { useState } from 'react'
import { usePendingCaptures } from '../hooks/use-pending-captures'
import type { CaptureServices } from '../types'
import { CaptureDialog } from './CaptureDialog'

// 起動の直後に 1 回だけ edge の未送信を取り、条件を満たすときだけ画面を重ねる（P1）。閉じたら二度と出ない（再読み込みまで）。
// State設計: Server state: 未送信の一覧（TanStack Query、1 回だけ・リトライなし） / Shared state なし / Local UI: dismissed / useEffect なし

type Props = { svc: CaptureServices; apiBaseUrl: string }

export function CaptureOffer({ svc, apiBaseUrl }: Props) {
  const [dismissed, setDismissed] = useState(false)
  const { list, offer } = usePendingCaptures(svc)
  if (dismissed || !offer || !list) return null
  return (
    <CaptureDialog
      svc={svc}
      apiBaseUrl={apiBaseUrl}
      list={list}
      onClose={() => {
        setDismissed(true)
      }}
    />
  )
}
