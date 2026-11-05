// アプリを組み立てられないときの応答（docs/specs/deploy-a/functional.md R3）。HTTP の知識はここに閉じる。
// 理由（env の名前・例外のメッセージ）は応答に出さない（ログにだけ出す）。

export function unavailableResponse(): Response {
  return Response.json(
    {
      error: {
        code: 'UNAVAILABLE',
        message: 'ただいま使えません。しばらくしてもう一度試してください',
      },
    },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  )
}
