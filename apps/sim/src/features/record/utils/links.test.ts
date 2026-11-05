import { recordImageUrl, recordShareUrl } from './links'

// deploy-a R10: 同じオリジン（VITE_API_BASE_URL が空）でも共有の URL は絶対の URL

describe('共有の URL（deploy-a R10）', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('REC-7b: VITE_API_BASE_URL が空ならページのオリジンを付ける', () => {
    vi.stubEnv('VITE_API_BASE_URL', '')
    expect(recordShareUrl('AbCdEfGh')).toBe(`${window.location.origin}/t/AbCdEfGh`)
    expect(recordImageUrl('AbCdEfGh')).toBe(`${window.location.origin}/t/AbCdEfGh/og.png`)
    expect(recordShareUrl('AbCdEfGh')).toMatch(/^https?:\/\//)
  })

  it('REC-7b: 値があれば今までどおりその値（末尾の / は落とす）', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.ezoroad.example/')
    expect(recordShareUrl('AbCdEfGh')).toBe('https://api.ezoroad.example/t/AbCdEfGh')
    expect(recordImageUrl('AbCdEfGh')).toBe('https://api.ezoroad.example/t/AbCdEfGh/og.png')
  })
})
