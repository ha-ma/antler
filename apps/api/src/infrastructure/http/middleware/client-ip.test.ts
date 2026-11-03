import { Hono } from 'hono'
import { clientIpKey, type ClientIpOptions } from './client-ip.js'

async function keyFor(options: ClientIpOptions, headers: Record<string, string> = {}) {
  // 変数名を app にしない（sfad-drift が `app.get(` をルートとして数えるため。試験だけのルート）
  const probe = new Hono()
  const key = clientIpKey(options)
  probe.get('/', (c) => c.text(key(c)))
  const res = await probe.request('/', { headers })
  return res.text()
}

const socket = () => '10.0.0.5'

describe('clientIpKey（R9 プロキシのヘッダは設定したときだけ信じる）', () => {
  it('TRUST_PROXY でなければ X-Forwarded-For を無視してソケットの接続元を使う', async () => {
    expect(
      await keyFor({ trustProxy: false, remoteAddress: socket }, { 'X-Forwarded-For': '1.2.3.4' }),
    ).toBe('10.0.0.5')
  })

  it('TRUST_PROXY なら右端（直前のプロキシが付けた値）を使う。左側の偽装は効かない', async () => {
    expect(
      await keyFor(
        { trustProxy: true, remoteAddress: socket },
        { 'X-Forwarded-For': '6.6.6.6, 203.0.113.9' },
      ),
    ).toBe('203.0.113.9')
    expect(await keyFor({ trustProxy: true, remoteAddress: socket })).toBe('10.0.0.5')
  })

  it('接続元が取れなければ unknown', async () => {
    expect(await keyFor({ trustProxy: false, remoteAddress: () => undefined })).toBe('unknown')
  })
})
