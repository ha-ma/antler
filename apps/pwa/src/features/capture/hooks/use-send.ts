import { useMutation } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { createEdgeApi } from '../lib/edge-api'
import { withTimeout } from '../lib/http'
import { sendAll, type SendProgress, type SendStop, type SendTotals } from '../lib/send-all'
import { uploadCapture } from '../lib/upload'
import type { CaptureServices } from '../types'

export type SendPhase = 'idle' | 'sending' | 'done' | 'stopped'

const ZERO: SendProgress = { provided: 0, failed: 0, removed: 0, waiting: false }

/**
 * 「送る」「提供しない」の実行。1 件ずつ順番に（P3）。
 * 止まったあとの「もう一度」は同じ send を呼ぶ: 送信済みは edge の一覧から消えているので続きから進み、件数は足し続ける。
 */
export function useSend(svc: CaptureServices, apiBaseUrl: string) {
  const [progress, setProgress] = useState<SendProgress>(ZERO)
  const carry = useRef<SendTotals>({ provided: 0, failed: 0, removed: 0 })
  const deps = useMemo(
    () => ({
      edge: createEdgeApi({
        baseUrl: svc.edgeBaseUrl,
        fetch: svc.fetch,
        listMs: svc.timeouts.edgeMs,
        edgeMs: svc.timeouts.edgeMs,
      }),
      apiFetch: withTimeout(svc.fetch, svc.timeouts.apiMs),
    }),
    [svc],
  )

  const mutation = useMutation({
    mutationFn: (consent: boolean) =>
      sendAll({
        consent,
        edge: deps.edge,
        upload: (capture, image) =>
          uploadCapture({ baseUrl: apiBaseUrl, capture, image, fetch: deps.apiFetch }),
        sleep: svc.sleep,
        carry: carry.current,
        onProgress: setProgress,
      }),
    onSuccess: ({ provided, failed, removed }) => {
      carry.current = { provided, failed, removed }
    },
  })

  let phase: SendPhase = 'idle'
  let stop: SendStop | null = null
  if (mutation.isPending) {
    phase = 'sending'
  } else if (mutation.data) {
    stop = mutation.data.stopped
    phase = stop === null ? 'done' : 'stopped'
  } else if (mutation.isError) {
    phase = 'stopped'
    stop = 'network'
  }

  const send = (consent: boolean) => {
    if (mutation.isPending) return
    mutation.mutate(consent)
  }
  const totals: SendTotals = mutation.data ?? progress
  return { phase, totals, waiting: phase === 'sending' && progress.waiting, stop, send }
}
