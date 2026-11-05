// Vercel の関数で、利用者の IP をヘッダから取る（docs/specs/deploy-a/functional.md R8）。
// 関数は fetch(Request) で呼ばれ、Node のソケット（getConnInfo）が無い。Vercel は X-Forwarded-For を
// 接続元の IP 1 つで上書きし、x-real-ip・x-vercel-forwarded-for も同じ値にする（公式の資料 Request headers）。
// 読む順: x-vercel-forwarded-for の右端 → x-real-ip → x-forwarded-for の右端。
// 右端を使うのは、上書きされずに値が足された場合でも、利用者が書ける左側を使わないため。
// IP は数えの鍵にするだけで、保存・ログ出力しない（plan-trip の threat.md）。

type HeaderSource = { header(name: string): string | undefined }

function rightmost(value: string | undefined): string | undefined {
  return value
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .at(-1)
}

export function vercelClientIp(headers: HeaderSource): string | undefined {
  return (
    rightmost(headers.header('x-vercel-forwarded-for')) ??
    rightmost(headers.header('x-real-ip')) ??
    rightmost(headers.header('x-forwarded-for'))
  )
}
