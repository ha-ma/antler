// 送り先の URL（P4、docs/specs/pwa-https R5）。
// edge の Capture サーバーは WebSocket と同じホストの 8767。connect の resolveEdgeUrl と同じ考え方で、
// ページのホストが VITE_EDGE_HOSTS にあればそれ、なければ一覧の先頭。ページが https なら https。
// 開発ビルドだけ ?edge=host[:port] の host を使う（port は WebSocket のものなので捨てる）。
// api は VITE_API_BASE_URL（必須）。同じオリジンへの代わりは作らない。

import {
  devEdgeOverride,
  EDGE_CAPTURE_PORT,
  parseEdgeHosts,
  resolveEdgeTarget,
  type PageLocation,
} from '@/shared/lib/edge-hosts'

export const DEFAULT_EDGE_CAPTURE_URL = `http://ezoroad.local:${EDGE_CAPTURE_PORT}`

export function resolveEdgeCaptureUrl(
  page: PageLocation,
  dev: boolean,
  hostsEnv?: unknown,
): string {
  const scheme = page.protocol === 'https:' ? 'https' : 'http'
  if (dev) {
    const override = devEdgeOverride(page.search)
    if (override) return `${scheme}://${override.host}:${EDGE_CAPTURE_PORT}`
  }
  const target = resolveEdgeTarget(page, parseEdgeHosts(hostsEnv))
  return `${target.secure ? 'https' : 'http'}://${target.host}:${EDGE_CAPTURE_PORT}`
}

/** VITE_API_BASE_URL を読む。http(s) の URL でなければ undefined（= 送り先が無い）。末尾のスラッシュは落とす（パスの接頭辞は残す）。 */
export function resolveApiBaseUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return undefined
  }
}
