import { createClient } from '@libsql/client/http'
import { drizzle } from 'drizzle-orm/libsql/http'
import type { Connection } from './connection.js'
import * as schema from './schema.js'

// Turso（ホスティングの libsql）への接続（docs/specs/deploy-a/functional.md R5）。
// HTTP のクライアントだけを使う（@libsql/client の Node の入口はネイティブの libsql を読み、
// その束は Vercel の関数に入らない）。libsql:// は HTTPS の HTTP クライアントになる。
// 1 回の HTTP は TURSO_FETCH_TIMEOUT_MS で打ち切る（fetch には既定の時間切れが無い。spec-adversary W3）。

export const TURSO_FETCH_TIMEOUT_MS = 10_000

export type RemoteDatabaseOptions = {
  url: string
  authToken: string
  /** 1 回の HTTP の上限（ミリ秒） */
  timeoutMs?: number
  /** テストで差し替える */
  fetch?: typeof globalThis.fetch
}

/** 渡された fetch に時間切れを足す（呼び出し側の signal があれば両方で止める） */
export function fetchWithTimeout(
  base: typeof globalThis.fetch,
  timeoutMs: number,
): typeof globalThis.fetch {
  return (input, init) => {
    const timeout = AbortSignal.timeout(timeoutMs)
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
    return base(input, { ...init, signal })
  }
}

export function openRemoteDatabase({
  url,
  authToken,
  timeoutMs = TURSO_FETCH_TIMEOUT_MS,
  fetch: baseFetch = globalThis.fetch,
}: RemoteDatabaseOptions): Connection {
  if (!/^(?:libsql|https?):\/\//i.test(url)) {
    throw new Error('Turso の URL は libsql:// か https:// で書く（file: はこの接続では開かない）')
  }
  const client = createClient({ url, authToken, fetch: fetchWithTimeout(baseFetch, timeoutMs) })
  return { client, db: drizzle({ client, schema }) }
}
