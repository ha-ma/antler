import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { CaptureGate } from '@/features/capture'
import { ConnectFlow } from '@/features/connect'
import { AppErrorBoundary } from './AppErrorBoundary'

/** プロバイダとレイアウトの外枠。画面（B-0・B-1）は connect feature の barrel から組み立てる。走行後の同意は CaptureGate を上に重ねる。 */
export function App() {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ConnectFlow />
        <CaptureGate />
      </QueryClientProvider>
    </AppErrorBoundary>
  )
}
