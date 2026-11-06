import { describe, expect, it } from 'vitest'
import { DEFAULT_EDGE_URL, resolveEdgeUrl } from './edge-url'

/** ページの URL から PageLocation を作る。 */
function page(url: string) {
  const u = new URL(url)
  return { protocol: u.protocol, hostname: u.hostname, search: u.search }
}

const HTTP = 'http://ezoroad.local:5174/'

describe('UC-1 接続先', () => {
  it('UC-1b: 既定は ws://ezoroad.local:8765/alerts', () => {
    expect(DEFAULT_EDGE_URL).toBe('ws://ezoroad.local:8765/alerts')
    expect(resolveEdgeUrl(page(HTTP), true)).toBe(DEFAULT_EDGE_URL)
    expect(resolveEdgeUrl(page(HTTP), false)).toBe(DEFAULT_EDGE_URL)
  })

  it('UC-1c: 開発ビルドでは ?edge= が使われ、本番ビルドでは無視する', () => {
    expect(resolveEdgeUrl(page(`${HTTP}?edge=192.168.4.1:8765`), true)).toBe(
      'ws://192.168.4.1:8765/alerts',
    )
    expect(resolveEdgeUrl(page(`${HTTP}?edge=localhost:9000`), true)).toBe(
      'ws://localhost:9000/alerts',
    )
    expect(resolveEdgeUrl(page(`${HTTP}?edge=localhost`), true)).toBe('ws://localhost:8765/alerts')
    expect(resolveEdgeUrl(page(`${HTTP}?edge=192.168.4.1:8765`), false)).toBe(DEFAULT_EDGE_URL)
  })

  it.each([
    ['パス付き', '?edge=evil.example/x'],
    ['ws:// 付き', '?edge=ws://evil.example'],
    ['空', '?edge='],
    ['ポート 0', '?edge=localhost:0'],
    ['ポート 70000', '?edge=localhost:70000'],
    ['HTML', '?edge=%3Cscript%3E'],
    ['認証情報', '?edge=user@evil.example'],
  ])('UC-1d: 不正な値（%s）は無視して既定', (_name, search) => {
    expect(resolveEdgeUrl(page(`${HTTP}${search}`), true)).toBe(DEFAULT_EDGE_URL)
  })
})

describe('UC-5 PWA の接続先（pwa-https R5）', () => {
  const HOSTS = 'ezoroad.local,192.168.2.1'

  it('UC-5a: https のページで、ページのホストが一覧にあれば wss でそのホストへ', () => {
    expect(resolveEdgeUrl(page('https://192.168.2.1:8443/'), false, HOSTS)).toBe(
      'wss://192.168.2.1:8765/alerts',
    )
    expect(resolveEdgeUrl(page('https://ezoroad.local:8443/drive'), false, HOSTS)).toBe(
      'wss://ezoroad.local:8765/alerts',
    )
  })

  it('UC-5b: ページのホストが一覧に無ければ一覧の先頭（既定 ezoroad.local）', () => {
    expect(resolveEdgeUrl(page('https://192.168.9.9:8443/'), false, HOSTS)).toBe(
      'wss://ezoroad.local:8765/alerts',
    )
    expect(resolveEdgeUrl(page('https://evil.example/'), false, '192.168.2.1')).toBe(
      'wss://192.168.2.1:8765/alerts',
    )
    expect(resolveEdgeUrl(page('https://192.168.2.1:8443/'), false)).toBe(
      'wss://ezoroad.local:8765/alerts',
    )
  })

  it('UC-5c: http のページなら ws（今と同じ）', () => {
    expect(resolveEdgeUrl(page('http://192.168.2.1:8080/'), false, HOSTS)).toBe(
      'ws://192.168.2.1:8765/alerts',
    )
    expect(resolveEdgeUrl(page('http://localhost:4173/'), false)).toBe(DEFAULT_EDGE_URL)
  })

  it('UC-5e: 開発ビルドの ?edge= はページのスキームに合わせる。本番では無視する', () => {
    expect(resolveEdgeUrl(page('https://localhost:5174/?edge=localhost:9443'), true)).toBe(
      'wss://localhost:9443/alerts',
    )
    expect(resolveEdgeUrl(page('https://192.168.2.1:8443/?edge=evil.example'), false, HOSTS)).toBe(
      'wss://192.168.2.1:8765/alerts',
    )
  })
})
