// 本番ビルドの Content-Security-Policy を組み立てる純粋な関数（vite.config.ts とテストの両方から読む）。何も import しない。
// 接続先は Mac Mini の WebSocket（8765）と、走行後の同意のための edge の Capture サーバー（8767）と、api（VITE_API_BASE_URL）だけ。
// フォントはオフライン用に同梱する（ch8 規約 4）。

export const EDGE_CAPTURE_ORIGIN = 'http://ezoroad.local:8767'

/** VITE_API_BASE_URL のオリジン。http(s) の URL でなければ undefined（api は足さない）。 */
export function apiOrigin(apiBaseUrl: unknown): string | undefined {
  if (typeof apiBaseUrl !== 'string' || apiBaseUrl.trim() === '') return undefined
  try {
    const url = new URL(apiBaseUrl.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : undefined
  } catch {
    return undefined
  }
}

export function buildCsp(apiBaseUrl?: unknown): string {
  const api = apiOrigin(apiBaseUrl)
  const connect = ["'self'", 'ws://ezoroad.local:8765', EDGE_CAPTURE_ORIGIN, ...(api ? [api] : [])]
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'self'",
    `img-src 'self' data: blob: ${EDGE_CAPTURE_ORIGIN}`,
    "media-src 'self'",
    `connect-src ${connect.join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ')
}
