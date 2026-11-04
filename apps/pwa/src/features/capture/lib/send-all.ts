import { CaptureSchema, isUploadable, type Capture } from '@antler/schema'
import { EdgeError, type EdgeApi, type PendingItem } from './edge-api'
import type { UploadResult } from './upload'

// 走行後の送信の手順（functional.md P3）。1 件ずつ順番に（同時 1）。
// 同意が edge に書けなければ api へ何も送らない。送れなかった分は未送信のまま残り、「もう一度」で続きから。

export type SendStop =
  /** 回線の失敗・時間切れ・5xx */
  | 'network'
  /** 429 のまま（待っても通らなかった） */
  | 'busy'
  /** 404・405 など。送り先の設定違い */
  | 'misconfigured'
  /** 車載（edge）に届かない・応答が使えない */
  | 'edge'

export type SendTotals = {
  /** api に受け取られた件数 */
  provided: number
  /** 送らなかった・受け取られなかった件数 */
  failed: number
  /** 「提供しない」で edge から消した件数 */
  removed: number
}
export type SendOutcome = SendTotals & { stopped: SendStop | null }
export type SendProgress = SendTotals & { waiting: boolean }

export type SendDeps = {
  /** チェックの値。true で送る、false で edge から消す */
  consent: boolean
  edge: EdgeApi
  upload: (capture: Capture, image: Blob) => Promise<UploadResult>
  sleep: (ms: number) => Promise<void>
  /** 前回までに扱った件数（「もう一度」で足し続ける） */
  carry?: SendTotals
  onProgress?: (progress: SendProgress) => void
}

/** edge の一覧と同意の POST の 1 回の上限 */
export const PAGE_SIZE = 200
/** edge の一覧の上限 */
const LIST_LIMIT_MAX = 500
/** 1 回の起動で保存されるのは最大 300 枚。ページ繰り返しの暴走を止める安全弁 */
const MAX_PAGES = 10

class Stop extends Error {
  readonly reason: SendStop
  constructor(reason: SendStop) {
    super(reason)
    this.name = 'Stop'
    this.reason = reason
  }
}

async function viaEdge<T>(call: Promise<T>): Promise<T> {
  try {
    return await call
  } catch {
    throw new Stop('edge')
  }
}

export async function sendAll(deps: SendDeps): Promise<SendOutcome> {
  const { consent, edge, upload, sleep, onProgress } = deps
  const totals: SendTotals = { provided: 0, failed: 0, removed: 0, ...deps.carry }
  /** このセッションで扱った id。送信済みか削除になって未送信から消えるが、失敗して残ったものも二度扱わない */
  const handled = new Set<string>()
  const report = (waiting = false) => {
    onProgress?.({ ...totals, waiting })
  }

  async function sendOne(item: PendingItem): Promise<void> {
    const raw = item.capture
    // 同意のあるものだけ（AUTH-12）。形が壊れたものも送らない
    if (!isUploadable(raw)) {
      totals.failed += 1
      report()
      return
    }
    const capture = CaptureSchema.parse(raw)
    let image: Blob
    try {
      image = await edge.fetchImage(item.id)
    } catch (error) {
      if (error instanceof EdgeError && error.status === 404) {
        totals.failed += 1
        report()
        return
      }
      throw new Stop('edge')
    }

    let result = await upload(capture, image)
    if (result.kind === 'busy') {
      report(true)
      await sleep(result.retryAfterSeconds * 1000)
      report(false)
      result = await upload(capture, image)
      if (result.kind === 'busy') throw new Stop('busy')
    }

    switch (result.kind) {
      case 'ok':
      case 'replayed':
        totals.provided += 1
        report()
        // 送信済みの更新が失敗しても、次回の再送で api は 200 を返す（二重保存にならない。FAIL-10）
        await viaEdge(edge.markUploaded([item.id]))
        return
      case 'permanent':
        totals.failed += 1
        report()
        try {
          await edge.setConsent([item.id], false)
        } catch {
          // 消せなくても続ける（未送信に残るだけで、保持期間で消える）
        }
        return
      case 'retryable':
        throw new Stop('network')
      case 'misconfigured':
        throw new Stop('misconfigured')
    }
  }

  try {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const list = await viaEdge(
        edge.listPending(Math.min(LIST_LIMIT_MAX, PAGE_SIZE + handled.size)),
      )
      const ids = list.items
        .map((item) => item.id)
        .filter((id) => !handled.has(id))
        .slice(0, PAGE_SIZE)
      if (ids.length === 0) break
      for (const id of ids) handled.add(id)

      // この POST が成功しなければ、api へ何も送らない
      const updated = await viaEdge(edge.setConsent(ids, consent))
      if (!consent) {
        totals.removed += updated
        report()
        continue
      }

      // 同意が実際に書けたものだけを送る対象にする
      const again = await viaEdge(
        edge.listPending(Math.min(LIST_LIMIT_MAX, PAGE_SIZE + handled.size)),
      )
      const byId = new Map(again.items.map((item) => [item.id, item]))
      for (const id of ids) {
        const item = byId.get(id)
        if (!item) continue // 保持期間で消えた等
        const record = item.capture as { consent?: unknown }
        if (record.consent !== true) {
          totals.failed += 1
          report()
          continue
        }
        await sendOne(item)
      }
    }
  } catch (error) {
    return { ...totals, stopped: error instanceof Stop ? error.reason : 'network' }
  }
  return { ...totals, stopped: null }
}
