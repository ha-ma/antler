import { withTimeout } from './http'
import type { FetchLike } from './upload'

// 車載 edge の Capture サーバー（functional.md E5）。車内の Wi-Fi の中だけにある。
// 一覧は途中の Capture を検査しない（壊れた形も数える。送る直前に isUploadable で止める。UP-1c）。

/** edge の id の形（E4）。URL に入れる前に必ず検査する。 */
export const CAPTURE_ID = /^cap_[0-9a-f]{12}$/

export type PendingItem = { id: string; capture: unknown; uploaded: boolean }
export type PendingList = { items: PendingItem[]; total: number; idleSeconds: number | null }

/** edge の応答が使えない（届かない・status が 2xx でない・形が違う）。status が無ければ回線の失敗。 */
export class EdgeError extends Error {
  readonly status: number | null
  constructor(message: string, status: number | null) {
    super(message)
    this.name = 'EdgeError'
    this.status = status
  }
}

export type EdgeApi = {
  /** 未送信を新しい順に最大 limit 件（edge の上限は 500） */
  listPending(limit: number): Promise<PendingList>
  fetchImage(id: string): Promise<Blob>
  /** 同意を書く。false は edge がその画像と JSON を消す。更新（削除）した件数を返す */
  setConsent(ids: readonly string[], consent: boolean): Promise<number>
  /** 送信済みのしるしを付ける。付けた件数を返す */
  markUploaded(ids: readonly string[]): Promise<number>
}

export function imageUrl(baseUrl: string, id: string): string {
  return `${baseUrl}/captures/${id}/image`
}

export type EdgeApiOptions = {
  baseUrl: string
  fetch: FetchLike
  /** 一覧の打ち切り（既定 3 秒） */
  listMs: number
  /** 画像・同意・送信済みの打ち切り（既定 5 秒） */
  edgeMs: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

export function parsePendingList(raw: unknown): PendingList {
  if (!isRecord(raw) || !Array.isArray(raw['items'])) throw new EdgeError('bad_list', null)
  const total = nonNegativeNumber(raw['total'])
  const idle = raw['idleSeconds']
  if (total === undefined || !(idle === null || nonNegativeNumber(idle) !== undefined)) {
    throw new EdgeError('bad_list', null)
  }
  const items: PendingItem[] = []
  for (const entry of raw['items'] as unknown[]) {
    if (!isRecord(entry)) continue
    const capture = entry['capture']
    const id = isRecord(capture) ? capture['id'] : undefined
    if (typeof id !== 'string' || !CAPTURE_ID.test(id)) continue
    items.push({ id, capture, uploaded: entry['uploaded'] === true })
  }
  return { items, total, idleSeconds: idle as number | null }
}

export function createEdgeApi({ baseUrl, fetch, listMs, edgeMs }: EdgeApiOptions): EdgeApi {
  const listFetch = withTimeout(fetch, listMs)
  const edgeFetch = withTimeout(fetch, edgeMs)
  const common = { credentials: 'omit', referrerPolicy: 'no-referrer' } as const

  async function post(path: string, body: unknown): Promise<number> {
    const response = await edgeFetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ...common,
    })
    if (!response.ok) throw new EdgeError('http', response.status)
    const json = await response.json()
    const updated = isRecord(json) ? nonNegativeNumber(json['updated']) : undefined
    if (updated === undefined) throw new EdgeError('bad_updated', null)
    return updated
  }

  return {
    async listPending(limit) {
      const response = await listFetch(`${baseUrl}/captures?pending=1&limit=${limit}`, {
        ...common,
      })
      if (!response.ok) throw new EdgeError('http', response.status)
      return parsePendingList(await response.json())
    },
    async fetchImage(id) {
      if (!CAPTURE_ID.test(id)) throw new EdgeError('bad_id', 404)
      const response = await edgeFetch(imageUrl(baseUrl, id), { ...common })
      if (!response.ok) throw new EdgeError('http', response.status)
      return response.blob()
    },
    setConsent: (ids, consent) => post('/captures/consent', { consent, ids }),
    markUploaded: (ids) => post('/captures/uploaded', { ids }),
  }
}
