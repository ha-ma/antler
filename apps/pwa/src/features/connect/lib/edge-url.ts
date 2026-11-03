// 接続先（ch7「B WebSocket」）。既定は固定。開発ビルドだけ ?edge=host[:port] で変えられる（偽 edge に向けるため）。

export const DEFAULT_EDGE_URL = 'ws://ezoroad.local:8765/alerts'

const EDGE_PARAM = /^[A-Za-z0-9.-]{1,253}(?::(\d{1,5}))?$/

export function resolveEdgeUrl(search: string, dev: boolean): string {
  if (!dev) return DEFAULT_EDGE_URL
  const value = new URLSearchParams(search).get('edge')
  if (value === null) return DEFAULT_EDGE_URL
  const match = EDGE_PARAM.exec(value)
  if (!match) return DEFAULT_EDGE_URL
  const port = match[1]
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) return DEFAULT_EDGE_URL
  const hostPort = port === undefined ? `${value}:8765` : value
  return `ws://${hostPort}/alerts`
}
