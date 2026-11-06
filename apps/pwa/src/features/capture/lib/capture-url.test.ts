import { describe, expect, it } from 'vitest'
import { DEFAULT_EDGE_CAPTURE_URL, resolveApiBaseUrl, resolveEdgeCaptureUrl } from './capture-url'

/** ページの URL から PageLocation を作る。 */
function page(url: string) {
  const u = new URL(url)
  return { protocol: u.protocol, hostname: u.hostname, search: u.search }
}

const HTTP = 'http://ezoroad.local:5174/'

describe('送り先の URL（P4）', () => {
  it('URL-1a: edge の URL は WebSocket と同じホストで、ポートは 8767', () => {
    expect(DEFAULT_EDGE_CAPTURE_URL).toBe('http://ezoroad.local:8767')
    expect(resolveEdgeCaptureUrl(page(HTTP), false)).toBe('http://ezoroad.local:8767')
    // 本番は ?edge= を無視する
    expect(resolveEdgeCaptureUrl(page(`${HTTP}?edge=evil.example`), false)).toBe(
      'http://ezoroad.local:8767',
    )
  })

  it('URL-1a: 開発ビルドだけ ?edge=host[:port] の host を使い、ポートは 8767 に置き換える', () => {
    expect(resolveEdgeCaptureUrl(page(`${HTTP}?edge=192.168.1.5`), true)).toBe(
      'http://192.168.1.5:8767',
    )
    expect(resolveEdgeCaptureUrl(page(`${HTTP}?edge=localhost:8765`), true)).toBe(
      'http://localhost:8767',
    )
    expect(resolveEdgeCaptureUrl(page(HTTP), true)).toBe('http://ezoroad.local:8767')
    expect(resolveEdgeCaptureUrl(page(`${HTTP}?edge=a/b`), true)).toBe('http://ezoroad.local:8767')
    expect(resolveEdgeCaptureUrl(page(`${HTTP}?edge=host:99999`), true)).toBe(
      'http://ezoroad.local:8767',
    )
    expect(resolveEdgeCaptureUrl(page(`${HTTP}?edge=host:0`), true)).toBe(
      'http://ezoroad.local:8767',
    )
  })

  it('URL-1a: api の URL は VITE_API_BASE_URL。http(s) でなければ送り先が無い（undefined）', () => {
    expect(resolveApiBaseUrl('https://api.example.com')).toBe('https://api.example.com')
    expect(resolveApiBaseUrl('http://localhost:8804/')).toBe('http://localhost:8804')
    expect(resolveApiBaseUrl('https://example.com/v1/')).toBe('https://example.com/v1')
    expect(resolveApiBaseUrl(undefined)).toBeUndefined()
    expect(resolveApiBaseUrl('')).toBeUndefined()
    expect(resolveApiBaseUrl('   ')).toBeUndefined()
    expect(resolveApiBaseUrl('not a url')).toBeUndefined()
    expect(resolveApiBaseUrl('javascript:alert(1)')).toBeUndefined()
    expect(resolveApiBaseUrl('ftp://x.example')).toBeUndefined()
    expect(resolveApiBaseUrl(42)).toBeUndefined()
  })
})

describe('UC-5 Capture の送り先（pwa-https R5）', () => {
  const HOSTS = 'ezoroad.local,192.168.2.1'

  it('UC-5a/UC-5b/UC-5c: https のページなら https で、ページのホストが一覧にあればそのホストの 8767', () => {
    expect(resolveEdgeCaptureUrl(page('https://192.168.2.1:8443/'), false, HOSTS)).toBe(
      'https://192.168.2.1:8767',
    )
    expect(resolveEdgeCaptureUrl(page('https://192.168.9.9:8443/'), false, HOSTS)).toBe(
      'https://ezoroad.local:8767',
    )
    expect(resolveEdgeCaptureUrl(page('http://192.168.2.1:8080/'), false, HOSTS)).toBe(
      'http://192.168.2.1:8767',
    )
    expect(resolveEdgeCaptureUrl(page('https://localhost:5174/?edge=localhost'), true)).toBe(
      'https://localhost:8767',
    )
  })
})
