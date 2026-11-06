// 接続先（ch7「B WebSocket」、docs/specs/pwa-https R5）。
// 本番: ページのホスト名が許可の一覧（VITE_EDGE_HOSTS）にあればそれ、なければ一覧の先頭（既定 ezoroad.local）。
// ページが https なら wss。開発ビルドだけ ?edge=host[:port] で変えられる（偽 edge に向けるため）。

import {
  devEdgeOverride,
  EDGE_WS_PORT,
  parseEdgeHosts,
  resolveEdgeTarget,
  type PageLocation,
} from '@/shared/lib/edge-hosts'

export const DEFAULT_EDGE_URL = `ws://ezoroad.local:${EDGE_WS_PORT}/alerts`

export function resolveEdgeUrl(page: PageLocation, dev: boolean, hostsEnv?: unknown): string {
  const scheme = page.protocol === 'https:' ? 'wss' : 'ws'
  if (dev) {
    const override = devEdgeOverride(page.search)
    if (override) return `${scheme}://${override.host}:${override.port ?? EDGE_WS_PORT}/alerts`
  }
  const target = resolveEdgeTarget(page, parseEdgeHosts(hostsEnv))
  return `${target.secure ? 'wss' : 'ws'}://${target.host}:${EDGE_WS_PORT}/alerts`
}
