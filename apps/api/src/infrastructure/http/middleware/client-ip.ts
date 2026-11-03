import type { Context } from 'hono'

// レート制限の鍵になる利用者の IP（docs/specs/plan-trip/functional.md R9）。
// プロキシのヘッダ（X-Forwarded-For）は TRUST_PROXY を設定したときだけ信じる。そのときは右端の値
// （直前の信頼できるプロキシが付け足した、接続元の IP）を使う。左側は利用者が自由に書けるので使わない。
// IP はメモリで数えるだけで、保存・ログ出力しない（threat.md）。

export type ClientIpOptions = {
  trustProxy: boolean
  /** ソケットの接続元（ランタイムごとの取り方を di が渡す）。取れなければ undefined */
  remoteAddress: (c: Context) => string | undefined
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
      if (forwarded) return forwarded
    }
    return remoteAddress(c) ?? 'unknown'
  }
}
