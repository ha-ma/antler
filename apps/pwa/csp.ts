// 本番ビルドの Content-Security-Policy を組み立てる純粋な関数（vite.config.ts とテストの両方から読む）。
// 接続先は Mac Mini の WebSocket（8765）と、走行後の同意のための edge の Capture サーバー（8767）と、api（VITE_API_BASE_URL）だけ。
// edge のホストは VITE_EDGE_HOSTS の一覧（docs/specs/pwa-https R5）。各ホストについて、ページが http でも https でも
// つながるように ws / wss・http / https を並べる（'self' が別ポートに当たるかはブラウザで違うので頼らない）。
// フォントはオフライン用に同梱する（ch8 規約 4）。
// '@' の別名は vite.config.ts から読めないので、edge-hosts は相対パスで読む（edge-hosts は何も import しない）。

import { EDGE_CAPTURE_PORT, EDGE_WS_PORT, parseEdgeHosts } from './src/shared/lib/edge-hosts'

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

/** edge の Capture サーバーのオリジン（一覧の各ホストの https と http）。 */
export function edgeCaptureOrigins(edgeHosts?: unknown): string[] {
  return parseEdgeHosts(edgeHosts).flatMap((h) => [
    `https://${h}:${EDGE_CAPTURE_PORT}`,
    `http://${h}:${EDGE_CAPTURE_PORT}`,
  ])
}

/** edge の WebSocket と Capture のオリジン（一覧の各ホストの wss・ws・https・http）。 */
export function edgeConnectOrigins(edgeHosts?: unknown): string[] {
  return parseEdgeHosts(edgeHosts).flatMap((h) => [
    `wss://${h}:${EDGE_WS_PORT}`,
    `ws://${h}:${EDGE_WS_PORT}`,
    `https://${h}:${EDGE_CAPTURE_PORT}`,
    `http://${h}:${EDGE_CAPTURE_PORT}`,
  ])
}

export function buildCsp(apiBaseUrl?: unknown, edgeHosts?: unknown): string {
  const api = apiOrigin(apiBaseUrl)
  const connect = ["'self'", ...edgeConnectOrigins(edgeHosts), ...(api ? [api] : [])]
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'self'",
    `img-src 'self' data: blob: ${edgeCaptureOrigins(edgeHosts).join(' ')}`,
    "media-src 'self'",
    `connect-src ${connect.join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ')
}
