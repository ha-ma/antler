import { describe, expect, it } from 'vitest'
import { apiOrigin, buildCsp } from '../../../csp'

function directive(policy: string, name: string): string[] {
  const found = policy.split('; ').find((d) => d.startsWith(`${name} `))
  return found ? found.split(' ').slice(1) : []
}

const DEFAULT_EDGE = [
  'wss://ezoroad.local:8765',
  'ws://ezoroad.local:8765',
  'https://ezoroad.local:8767',
  'http://ezoroad.local:8767',
]

describe('本番ビルドの CSP', () => {
  it('CSP-1a: connect-src に edge の 8765・8767 と VITE_API_BASE_URL のオリジン、img-src に edge の 8767', () => {
    const policy = buildCsp('https://api.example.com/')
    expect(directive(policy, 'connect-src')).toEqual([
      "'self'",
      ...DEFAULT_EDGE,
      'https://api.example.com',
    ])
    expect(directive(policy, 'img-src')).toEqual([
      "'self'",
      'data:',
      'blob:',
      'https://ezoroad.local:8767',
      'http://ezoroad.local:8767',
    ])
  })

  it('CSP-1a: VITE_API_BASE_URL が無い（読めない）ときは api を足さない', () => {
    for (const value of [undefined, '', 'nonsense', 'javascript:alert(1)', 42]) {
      expect(directive(buildCsp(value), 'connect-src')).toEqual(["'self'", ...DEFAULT_EDGE])
    }
    expect(apiOrigin('http://localhost:8804/api')).toBe('http://localhost:8804')
  })

  it('CSP-1a: script-src などほかの指示は変わらない（ワイルドカード・unsafe を入れない）', () => {
    const policy = buildCsp('https://api.example.com', 'ezoroad.local,192.168.2.1')
    expect(directive(policy, 'default-src')).toEqual(["'self'"])
    expect(directive(policy, 'script-src')).toEqual(["'self'"])
    expect(directive(policy, 'style-src')).toEqual(["'self'"])
    expect(directive(policy, 'font-src')).toEqual(["'self'"])
    expect(directive(policy, 'media-src')).toEqual(["'self'"])
    expect(directive(policy, 'object-src')).toEqual(["'none'"])
    expect(directive(policy, 'base-uri')).toEqual(["'self'"])
    expect(policy).not.toMatch(/unsafe|\*/)
  })

  it('UC-5f: VITE_EDGE_HOSTS の各ホストの wss・ws・https・http が入り、一覧に無いホストは入らない', () => {
    const policy = buildCsp(undefined, 'ezoroad.local, 192.168.2.1, evil.example/x')
    expect(directive(policy, 'connect-src')).toEqual([
      "'self'",
      ...DEFAULT_EDGE,
      'wss://192.168.2.1:8765',
      'ws://192.168.2.1:8765',
      'https://192.168.2.1:8767',
      'http://192.168.2.1:8767',
    ])
    expect(directive(policy, 'img-src')).toEqual([
      "'self'",
      'data:',
      'blob:',
      'https://ezoroad.local:8767',
      'http://ezoroad.local:8767',
      'https://192.168.2.1:8767',
      'http://192.168.2.1:8767',
    ])
    expect(policy).not.toContain('evil.example')
    // 一覧に無い IP は入らない（Mac mini の self_check はこれを warn にする）
    expect(policy).not.toContain('192.168.9.9')
  })
})
