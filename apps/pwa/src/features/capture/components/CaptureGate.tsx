import { useState } from 'react'
import { createBrowserServices } from '../services'
import type { CaptureServices } from '../types'
import { CaptureOffer } from './CaptureOffer'

// 走行後の同意（P1）。App が ConnectFlow の兄弟として置く。重なりは CSS の position: fixed。
// 送り先（VITE_API_BASE_URL）が無ければ何も描かず、通信もしない（B-0 は今までどおり）。
// State設計: Server state なし（OFFER 側）/ Shared state なし / Local UI: services のみ / useEffect なし

export function CaptureGate({ services }: { services?: CaptureServices }) {
  const [svc] = useState(() => services ?? createBrowserServices())
  if (svc.apiBaseUrl === undefined) return null
  return <CaptureOffer svc={svc} apiBaseUrl={svc.apiBaseUrl} />
}
