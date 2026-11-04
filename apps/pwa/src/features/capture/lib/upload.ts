import type { Capture } from '@antler/schema'

// api の POST /api/captures を呼ぶ純粋な関数（P5）。PWA にも sim にも依存しない。
// 欄名（capture・image）と応答の読み方はここだけ。sim が使うときは、このファイルごと共有パッケージへ移す。

/** 使う分だけの応答。ブラウザの Response はこれを満たす。 */
export type ResponseLike = {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
  blob(): Promise<Blob>
}

/** ブラウザの fetch と同じ形（テストでは偽物を差し込む）。 */
export type FetchLike = (url: string, init?: RequestInit) => Promise<ResponseLike>

export type UploadResult =
  /** 201: 保存した */
  | { kind: 'ok' }
  /** 200: すでに同じものがある（再送。二重保存にならない） */
  | { kind: 'replayed' }
  /** 400・409・413・422: 再送しても直らない */
  | { kind: 'permanent'; status: number }
  /** 429: Retry-After の秒だけ待って、もう一度 */
  | { kind: 'busy'; retryAfterSeconds: number }
  /** 回線の失敗・時間切れ・5xx: 回線がつながってからもう一度 */
  | { kind: 'retryable'; status: number | null }
  /** 404・405 など: 送り先の設定違い */
  | { kind: 'misconfigured'; status: number }

/** Retry-After の上限（api のレート制限は 1 分の窓。ch7 A1） */
export const MAX_RETRY_AFTER_SECONDS = 65
/** Retry-After が読めないときの待ち */
export const DEFAULT_RETRY_AFTER_SECONDS = 5

export function parseRetryAfter(value: string | null): number {
  if (value === null || !/^\d{1,6}$/.test(value.trim())) return DEFAULT_RETRY_AFTER_SECONDS
  return Math.min(Number(value.trim()), MAX_RETRY_AFTER_SECONDS)
}

const PERMANENT = new Set([400, 409, 413, 422])

export function classifyStatus(status: number, retryAfter: string | null): UploadResult {
  if (status === 201) return { kind: 'ok' }
  if (status === 200) return { kind: 'replayed' }
  if (PERMANENT.has(status)) return { kind: 'permanent', status }
  if (status === 429) return { kind: 'busy', retryAfterSeconds: parseRetryAfter(retryAfter) }
  if (status >= 500 && status <= 599) return { kind: 'retryable', status }
  return { kind: 'misconfigured', status }
}

export type UploadOptions = {
  /** api のオリジン（末尾のスラッシュなし）。例: https://api.example.com */
  baseUrl: string
  capture: Capture
  image: Blob
  fetch: FetchLike
}

export async function uploadCapture({
  baseUrl,
  capture,
  image,
  fetch,
}: UploadOptions): Promise<UploadResult> {
  const form = new FormData()
  form.append('capture', JSON.stringify(capture))
  form.append(
    'image',
    image,
    image.type === 'image/png' ? `${capture.id}.png` : `${capture.id}.jpg`,
  )
  let response: ResponseLike
  try {
    response = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      body: form,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
  } catch {
    return { kind: 'retryable', status: null }
  }
  return classifyStatus(response.status, response.headers.get('Retry-After'))
}
