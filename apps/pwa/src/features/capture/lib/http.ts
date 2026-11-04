import type { FetchLike } from './upload'

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`timeout ${ms}ms`)
    this.name = 'TimeoutError'
  }
}

/**
 * fetch に打ち切りを足す。setTimeout + AbortController（偽タイマーで進められる）。
 * 打ち切りは応答のヘッダが届くまで。fetch が signal を無視しても race で必ず止まる。
 */
export function withTimeout(fetchLike: FetchLike, ms: number): FetchLike {
  return (url, init) =>
    new Promise((resolve, reject) => {
      const controller = new AbortController()
      const timer = setTimeout(() => {
        controller.abort()
        reject(new TimeoutError(ms))
      }, ms)
      fetchLike(url, { ...init, signal: controller.signal }).then(
        (response) => {
          clearTimeout(timer)
          resolve(response)
        },
        (error: unknown) => {
          clearTimeout(timer)
          reject(error instanceof Error ? error : new Error(String(error)))
        },
      )
    })
}
