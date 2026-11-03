import { Hono } from 'hono'
import { clientIpKey, rateLimitBucket, type ClientIpOptions } from './client-ip.js'

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

  it('W2: IPv6 は /64 にまとめる（ソケットでも X-Forwarded-For でも）', async () => {
    const a = await keyFor({ trustProxy: false, remoteAddress: () => '2001:db8:1:2:aaaa::1' })
    // 先頭 64 ビットが同じで、後ろだけ替えたアドレス
    const b = await keyFor(
      { trustProxy: true, remoteAddress: socket },
      { 'X-Forwarded-For': '2001:0DB8:0001:0002:ffff:1:2:3' },
    )
    expect(a).toBe('2001:0db8:0001:0002::/64')
    expect(b).toBe(a)
  })
})

describe('rateLimitBucket', () => {
  it('IPv4 はそのまま、IPv4 を写した IPv6 は IPv4 にする', () => {
    expect(rateLimitBucket('203.0.113.9')).toBe('203.0.113.9')
    expect(rateLimitBucket('::ffff:203.0.113.9')).toBe('203.0.113.9')
  })

  it('IPv6 の省略形・括弧・ゾーンを読み、/64 にまとめる', () => {
    expect(rateLimitBucket('::1')).toBe('0000:0000:0000:0000::/64')
    expect(rateLimitBucket('[2001:db8::1]:443')).toBe('2001:0db8:0000:0000::/64')
    expect(rateLimitBucket('fe80::1%eth0')).toBe('fe80:0000:0000:0000::/64')
    expect(rateLimitBucket('2001:db8:a:b:c:d:e:f')).toBe('2001:0db8:000a:000b::/64')
    expect(rateLimitBucket('64:ff9b::192.0.2.33')).toBe('0064:ff9b:0000:0000::/64')
  })

  it('読めない値はそのまま（小文字）を鍵にする', () => {
    expect(rateLimitBucket('1:2:3')).toBe('1:2:3')
    expect(rateLimitBucket('1::2::3')).toBe('1::2::3')
    expect(rateLimitBucket('GG::1')).toBe('gg::1')
  })
})
