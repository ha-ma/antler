// 車内の edge（Mac mini）の場所（docs/specs/pwa-https R5）。純粋な関数だけで、何も import しない
// （vite.config.ts から csp.ts 経由でも読むため。'@' の別名は使えない）。
//
// 本番ビルドの接続先のホストは、ページのホスト名が許可の一覧（ビルドの環境変数 VITE_EDGE_HOSTS）にあれば
// それ、なければ一覧の先頭。スキームはページが https: なら wss: / https:、それ以外は ws: / http:。
// Mac mini が PWA を https で配るので、ページと同じホストにつなげば証明書と CSP がそろう。

export const DEFAULT_EDGE_HOST = 'ezoroad.local'
export const EDGE_WS_PORT = 8765
export const EDGE_CAPTURE_PORT = 8767
export const MAX_EDGE_HOSTS = 8

const HOST_NAME =
  /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/
const IPV4 = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

/** ホスト名か IPv4 の形か（スキーム・ポート・パス・空白を含まない）。 */
export function isEdgeHost(value: string): boolean {
  if (IPV4.test(value)) return true
  // 数字とドットだけの名前は壊れた IPv4（999.1.1.1 など）として捨てる
  if (/^[\d.]+$/.test(value)) return false
  return HOST_NAME.test(value)
}

/** VITE_EDGE_HOSTS（カンマ区切り）を読む。形の違う項目は捨て、最大 8 件。全部だめなら ezoroad.local。 */
export function parseEdgeHosts(value: unknown): string[] {
  if (typeof value !== 'string') return [DEFAULT_EDGE_HOST]
  const hosts: string[] = []
  for (const raw of value.split(',')) {
    const host = raw.trim().toLowerCase()
    if (host === '' || !isEdgeHost(host) || hosts.includes(host)) continue
    hosts.push(host)
    if (hosts.length === MAX_EDGE_HOSTS) break
  }
  return hosts.length > 0 ? hosts : [DEFAULT_EDGE_HOST]
}

export type PageLocation = { protocol: string; hostname: string; search: string }

export type EdgeTarget = { host: string; secure: boolean }

/** 本番の接続先: ページのホストが一覧にあればそれ、なければ一覧の先頭。 */
export function resolveEdgeTarget(page: PageLocation, hosts: readonly string[]): EdgeTarget {
  const hostname = page.hostname.toLowerCase()
  const host = hosts.includes(hostname) ? hostname : (hosts[0] ?? DEFAULT_EDGE_HOST)
  return { host, secure: page.protocol === 'https:' }
}

/** 開発ビルドの ?edge=host[:port]。形が違えば undefined（既定に戻す）。 */
export function devEdgeOverride(search: string): { host: string; port?: number } | undefined {
  const value = new URLSearchParams(search).get('edge')
  if (value === null) return undefined
  const match = /^([A-Za-z0-9.-]{1,253})(?::(\d{1,5}))?$/.exec(value)
  if (!match?.[1]) return undefined
  if (match[2] === undefined) return { host: match[1] }
  const port = Number(match[2])
  if (port < 1 || port > 65535) return undefined
  return { host: match[1], port }
}
