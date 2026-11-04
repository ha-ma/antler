import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { createEdgeApi, type PendingList } from '../lib/edge-api'
import { shouldOffer } from '../lib/gate-rule'
import type { CaptureServices } from '../types'

/** 一覧の 1 回の取得数（edge の既定。P3 のページ繰り返しもこの大きさ） */
const LIST_LIMIT = 200

/**
 * 起動の直後に 1 回だけ、edge の未送信の一覧を取る（P1）。リトライなし、打ち切りは services.timeouts.listMs（3 秒）。
 * 遅れて届いた答えは、打ち切りの時点で失敗に確定しているので使わない。
 * 画面に戻ったときなどに取り直さない（走行後の画面が遅れて出るのを防ぐ）。
 */
export function usePendingCaptures(svc: CaptureServices): {
  list: PendingList | undefined
  offer: boolean
} {
  const edge = useMemo(
    () =>
      createEdgeApi({
        baseUrl: svc.edgeBaseUrl,
        fetch: svc.fetch,
        listMs: svc.timeouts.listMs,
        edgeMs: svc.timeouts.edgeMs,
      }),
    [svc],
  )
  const query = useQuery({
    queryKey: ['capture', 'pending', svc.edgeBaseUrl],
    queryFn: () => edge.listPending(LIST_LIMIT),
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const list = query.data
  return { list, offer: list !== undefined && shouldOffer(list) }
}
