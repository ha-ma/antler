import type { Context } from 'hono'

// レート制限の鍵になる利用者の IP（docs/specs/plan-trip/functional.md R9）。
// プロキシのヘッダ（X-Forwarded-For）は TRUST_PROXY を設定したときだけ信じる。そのときは右端の値
// （直前の信頼できるプロキシが付け足した、接続元の IP）を使う。左側は利用者が自由に書けるので使わない。
// IPv6 は /64 にまとめて 1 つの枠にする（1 人が /64 を持つのが普通で、アドレスを替えて枠を増やせるため）。
// IP はメモリで数えるだけで、保存・ログ出力しない（threat.md）。

export type ClientIpOptions = {
  trustProxy: boolean
  /** ソケットの接続元（ランタイムごとの取り方を di が渡す）。取れなければ undefined */
  remoteAddress: (c: Context) => string | undefined
}

const HEXTET = /^[0-9a-f]{1,4}$/
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/

/** IPv6 を 8 つの 16 ビットの組に広げる。読めなければ null */
function expandIpv6(address: string): string[] | null {
  const halves = address.split('::')
  if (halves.length > 2) return null
  const toGroups = (part: string | undefined): string[] | null => {
    if (!part) return []
    const groups: string[] = []
    for (const g of part.split(':')) {
      if (IPV4.test(g)) {
        // 末尾に IPv4 を埋め込んだ形（::ffff:1.2.3.4 など）
        const [a = 0, b = 0, c = 0, d = 0] = g.split('.').map(Number)
        groups.push(((a << 8) | b).toString(16), ((c << 8) | d).toString(16))
      } else if (HEXTET.test(g)) {
        groups.push(g)
      } else {
        return null
      }
    }
    return groups
  }
  const head = toGroups(halves[0])
  const tail = toGroups(halves[1])
  if (!head || !tail) return null
  if (halves.length === 1) return head.length === 8 ? head : null
  const missing = 8 - head.length - tail.length
  if (missing < 1) return null
  return [...head, ...Array<string>(missing).fill('0'), ...tail]
}

/**
 * レート制限で同じ枠に数える単位。IPv4 はそのまま、IPv4 を写した IPv6（::ffff:a.b.c.d）は IPv4、
 * IPv6 は先頭の 64 ビット（/64）。読めない値はそのまま（小文字）を鍵にする。
 */
export function rateLimitBucket(ip: string): string {
  const address = ip
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\](?::\d+)?$/, '$1')
    .replace(/%.*$/, '')
  if (!address.includes(':')) return address
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address)
  if (mapped?.[1]) return mapped[1]
  const groups = expandIpv6(address)
  if (!groups) return address
  return `${groups
    .slice(0, 4)
    .map((g) => g.padStart(4, '0'))
    .join(':')}::/64`
}

export function clientIpKey({
  trustProxy,
  remoteAddress,
}: ClientIpOptions): (c: Context) => string {
  return (c) => {
    if (trustProxy) {
      const forwarded = c.req
        .header('x-forwarded-for')
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .at(-1)
      if (forwarded) return rateLimitBucket(forwarded)
    }
    const remote = remoteAddress(c)
    return remote ? rateLimitBucket(remote) : 'unknown'
  }
}
