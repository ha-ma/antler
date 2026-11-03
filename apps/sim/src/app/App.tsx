import '@antler/alert-ui/tokens.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { createBrowserRouter, RouterProvider, type DataRouter } from 'react-router'
import { AppErrorBoundary } from './AppErrorBoundary'
import { routes } from './routes'

type Props = {
  /** テストでは createMemoryRouter(routes) を渡す */
  router?: DataRouter
}

let browserRouter: DataRouter | null = null

/** ブラウザのルーターは 1 つだけ作る（StrictMode の 2 回の初期化でも作り直さない）。 */
function getBrowserRouter(): DataRouter {
  browserRouter ??= createBrowserRouter(routes)
  return browserRouter
}

/** プロバイダとルーティングの外枠。画面（A-1〜A-7）は feature の barrel から組み立てる（routes.tsx）。 */
export function App({ router }: Props) {
  const [queryClient] = useState(() => new QueryClient())
  const [appRouter] = useState(() => router ?? getBrowserRouter())
  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={appRouter} />
      </QueryClientProvider>
    </AppErrorBoundary>
  )
}
