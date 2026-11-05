import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { EdgeClient, type EdgeSnapshot, type SocketLike } from '../lib/edge-client'
import type { VehicleReport } from '../lib/vehicle-report'

/** 車載への接続を画面のあいだ保つ。画面が見える状態に戻ったら、切れていれば待たずにつなぎ直す。 */
export function useEdgeConnection(
  url: string,
  createSocket: (url: string) => SocketLike,
): {
  snapshot: EdgeSnapshot
  sendAck: (now: number) => boolean
  sendVehicle: (report: VehicleReport) => boolean
} {
  const [client] = useState(() => new EdgeClient({ url, createSocket }))
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot)

  // WebSocket とタイマーという外部のものとの同期（購読の hook に隔離）
  // eslint-disable-next-line no-restricted-syntax -- 購読
  useEffect(() => {
    client.start()
    const onVisible = () => {
      if (document.visibilityState === 'visible') client.wake()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      client.stop()
    }
  }, [client])

  const sendAck = useCallback((now: number) => client.sendAck(now), [client])
  const sendVehicle = useCallback((report: VehicleReport) => client.sendVehicle(report), [client])
  return { snapshot, sendAck, sendVehicle }
}
