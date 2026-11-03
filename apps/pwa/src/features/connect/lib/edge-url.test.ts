import { describe, expect, it } from 'vitest'
import { DEFAULT_EDGE_URL, resolveEdgeUrl } from './edge-url'

describe('UC-1 接続先', () => {
  it('UC-1b: 既定は ws://ezoroad.local:8765/alerts', () => {
    expect(DEFAULT_EDGE_URL).toBe('ws://ezoroad.local:8765/alerts')
    expect(resolveEdgeUrl('', true)).toBe(DEFAULT_EDGE_URL)
    expect(resolveEdgeUrl('', false)).toBe(DEFAULT_EDGE_URL)
  })

  it('UC-1c: 開発ビルドでは ?edge= が使われ、本番ビルドでは無視する', () => {
    expect(resolveEdgeUrl('?edge=192.168.4.1:8765', true)).toBe('ws://192.168.4.1:8765/alerts')
    expect(resolveEdgeUrl('?edge=localhost:9000', true)).toBe('ws://localhost:9000/alerts')
    expect(resolveEdgeUrl('?edge=localhost', true)).toBe('ws://localhost:8765/alerts')
    expect(resolveEdgeUrl('?edge=192.168.4.1:8765', false)).toBe(DEFAULT_EDGE_URL)
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
    expect(resolveEdgeUrl(search, true)).toBe(DEFAULT_EDGE_URL)
  })
})
