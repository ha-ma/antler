import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { AppErrorBoundary } from './AppErrorBoundary'

/** プロバイダとレイアウトの外枠。画面（B-0〜B-3）は feature の barrel から組み立てる。 */
export function App() {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <main>
          <h1>EZO ROAD</h1>
        </main>
      </QueryClientProvider>
    </AppErrorBoundary>
  )
}
