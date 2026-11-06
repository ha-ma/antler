import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EDGE_HOST,
  devEdgeOverride,
  isEdgeHost,
  MAX_EDGE_HOSTS,
  parseEdgeHosts,
  resolveEdgeTarget,
} from './edge-hosts'

describe('UC-5 VITE_EDGE_HOSTS（pwa-https R5）', () => {
  it('UC-5d: 不正な項目（パス・スキーム・空・HTML・ポート・壊れた IPv4）は捨て、全部だめなら ezoroad.local', () => {
    expect(parseEdgeHosts(' EZOROAD.local , 192.168.2.1 ,192.168.2.1')).toEqual([
      'ezoroad.local',
      '192.168.2.1',
    ])
    expect(
      parseEdgeHosts('a.example/x,wss://b.example,,<script>,c.example:8765,999.1.1.1,10.0.0.1'),
    ).toEqual(['10.0.0.1'])
    for (const bad of [undefined, '', ' , ', 'http://x', 42, null, '-bad-']) {
      expect(parseEdgeHosts(bad)).toEqual([DEFAULT_EDGE_HOST])
    }
  })

  it('UC-5d: 9 件目以降は捨てる', () => {
    const many = Array.from({ length: 12 }, (_, i) => `10.0.0.${i + 1}`).join(',')
    const hosts = parseEdgeHosts(many)
    expect(hosts).toHaveLength(MAX_EDGE_HOSTS)
    expect(hosts.at(-1)).toBe('10.0.0.8')
  })

  it('UC-5d: isEdgeHost はホスト名か IPv4 だけ', () => {
    expect(isEdgeHost('ezoroad.local')).toBe(true)
    expect(isEdgeHost('192.168.2.1')).toBe(true)
    expect(isEdgeHost('256.1.1.1')).toBe(false)
    expect(isEdgeHost('1.2.3')).toBe(false)
    expect(isEdgeHost('a b')).toBe(false)
    expect(isEdgeHost('[::1]')).toBe(false)
    expect(isEdgeHost('a..b')).toBe(false)
  })

  it('UC-5a/UC-5b: ページのホスト（大文字小文字を問わない）が一覧にあればそれ、なければ先頭', () => {
    const hosts = ['ezoroad.local', '192.168.2.1']
    expect(
      resolveEdgeTarget({ protocol: 'https:', hostname: '192.168.2.1', search: '' }, hosts),
    ).toEqual({ host: '192.168.2.1', secure: true })
    expect(
      resolveEdgeTarget({ protocol: 'https:', hostname: 'EZOROAD.LOCAL', search: '' }, hosts),
    ).toEqual({ host: 'ezoroad.local', secure: true })
    expect(
      resolveEdgeTarget({ protocol: 'http:', hostname: 'evil.example', search: '' }, hosts),
    ).toEqual({ host: 'ezoroad.local', secure: false })
    expect(resolveEdgeTarget({ protocol: 'https:', hostname: 'x', search: '' }, [])).toEqual({
      host: DEFAULT_EDGE_HOST,
      secure: true,
    })
  })

  it('UC-5e: ?edge=host[:port] の形だけ受け付ける', () => {
    expect(devEdgeOverride('?edge=localhost:9443')).toEqual({ host: 'localhost', port: 9443 })
    expect(devEdgeOverride('?edge=192.168.4.1')).toEqual({ host: '192.168.4.1' })
    expect(devEdgeOverride('')).toBeUndefined()
    expect(devEdgeOverride('?edge=a/b')).toBeUndefined()
    expect(devEdgeOverride('?edge=a:0')).toBeUndefined()
    expect(devEdgeOverride('?edge=a:65536')).toBeUndefined()
  })
})
