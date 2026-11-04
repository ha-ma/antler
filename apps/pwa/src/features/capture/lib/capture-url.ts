// 送り先の URL（P4）。
// edge の Capture サーバーは WebSocket と同じホストの 8767。connect の resolveEdgeUrl と同じ考え方で、
// 開発ビルドだけ ?edge=host[:port] の host を使う（port は WebSocket のものなので捨てる）。
// api は VITE_API_BASE_URL（必須）。同じオリジンへの代わりは作らない。

export const DEFAULT_EDGE_CAPTURE_URL = 'http://ezoroad.local:8767'
export const EDGE_CAPTURE_PORT = 8767

const EDGE_PARAM = /^([A-Za-z0-9.-]{1,253})(?::(\d{1,5}))?$/

export function resolveEdgeCaptureUrl(search: string, dev: boolean): string {
  if (!dev) return DEFAULT_EDGE_CAPTURE_URL
  const value = new URLSearchParams(search).get('edge')
  if (value === null) return DEFAULT_EDGE_CAPTURE_URL
  const match = EDGE_PARAM.exec(value)
  if (!match?.[1]) return DEFAULT_EDGE_CAPTURE_URL
  const port = match[2]
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535))
    return DEFAULT_EDGE_CAPTURE_URL
  return `http://${match[1]}:${EDGE_CAPTURE_PORT}`
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
