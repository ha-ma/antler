import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense, useState } from 'react'
import { AppErrorBoundary } from './AppErrorBoundary'

// /drive（A-3・A-5）は three・R3F を含むので遅延読込にする（ほかの画面の初回読込に入れない）。
// ルーティング（react-router）が入ったら、その Route に差し替える。
const DrivePage = lazy(() => import('@/features/drive').then((m) => ({ default: m.DrivePage })))

/** プロバイダとレイアウトの外枠。画面（A-1〜A-7）は feature の barrel から組み立てる。 */
export function App() {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        {window.location.pathname === '/drive' ? (
          <Suspense fallback={null}>
            <DrivePage />
          </Suspense>
        ) : (
          <main>
            <h1>EZO ROAD</h1>
          </main>
        )}
      </QueryClientProvider>
    </AppErrorBoundary>
  )
}
