import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

// 例外 → HTTP 応答。HTTP の status を知るのはここだけ（Hono stack の規約）。
// ドメイン例外を足したら、ここに code と status の対応を足す。

export type HttpError = { status: ContentfulStatusCode; code: string; message: string }

export function toHttpError(error: unknown): HttpError {
  if (error instanceof HTTPException) {
    return { status: error.status, code: 'HTTP_ERROR', message: error.message }
  }
  // 想定外の例外。利用者には中身（スタックトレース・内部メッセージ）を見せない
  return { status: 500, code: 'INTERNAL_ERROR', message: '内部エラーが発生しました' }
}
