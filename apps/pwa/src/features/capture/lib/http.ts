import type { FetchLike, ResponseLike } from './upload'

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`timeout ${ms}ms`)
    this.name = 'TimeoutError'
  }
}

/**
 * fetch に打ち切りを足す。setTimeout + AbortController（偽タイマーで進められる）。
 * 期限は 1 本: 応答のヘッダが届くまでも、本文（json()・blob()）を読み終えるまでも同じ ms の中。
 * fetch が signal を無視しても race で必ず止まる。本文を読まない呼び出しでは、期限が来ても何も起きない（abort は完了済みの通信に効かない）。
 */
export function withTimeout(fetchLike: FetchLike, ms: number): FetchLike {
  return (url, init) => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new TimeoutError(ms))
      }, ms)
    })
    // 本文を読まないまま期限が来ても、未処理の拒否にしない
    deadline.catch(() => undefined)

    const guard = async <T>(work: Promise<T>): Promise<T> => {
      try {
        return await Promise.race([work, deadline])
      } finally {
        clearTimeout(timer)
      }
    }
    // 本文の読み取りは、期限と競わせる。読み終えたら timer を片づける
    const guarded = (response: ResponseLike): ResponseLike => ({
      ok: response.ok,
      status: response.status,
      headers: response.headers,
      json: () => guard(response.json()),
      blob: () => guard(response.blob()),
    })

    return Promise.race([
      fetchLike(url, { ...init, signal: controller.signal }).then(guarded, (error: unknown) => {
        clearTimeout(timer)
        throw error instanceof Error ? error : new Error(String(error))
      }),
      deadline,
    ])
  }
}
