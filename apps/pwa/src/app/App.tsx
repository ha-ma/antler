import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { ConnectFlow } from '@/features/connect'
import { AppErrorBoundary } from './AppErrorBoundary'

/** プロバイダとレイアウトの外枠。画面（B-0・B-1）は connect feature の barrel から組み立てる。 */
export function App() {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ConnectFlow />
      </QueryClientProvider>
    </AppErrorBoundary>
  )
}
