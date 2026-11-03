import type { AlertSoundController } from '@antler/alert-ui'
import type { ZoneCollection } from '@antler/zones'
import type { SocketLike } from './lib/edge-client'
import type { GeoWatch } from './lib/gps'
import type { LocationDeps } from './lib/location'
import type { WakeLockDeps } from './lib/wake-lock'

/** ConnectFlow が使う外部の仕組み。ブラウザの実物は services.ts、テストでは偽物を差し込む。 */
export type ConnectServices = {
  url: string
  createSocket: (url: string) => SocketLike
  location: LocationDeps
  /** 走行中の位置の購読（navigator.geolocation）。無ければ undefined */
  geo: GeoWatch | undefined
  /** 同梱の鹿ゾーン DB を読んで照合する。失敗したら例外 */
  loadZones: () => Promise<ZoneCollection>
  wakeLock: WakeLockDeps
  sound: AlertSoundController
  /** 「テスト音を鳴らして出発」のテスト音（チャイム）。unlock のあとに呼ぶ */
  playTestSound: () => void
  /** iOS は読み上げもユーザー操作の中で 1 度流さないと、あとで黙る。空の発話を流す */
  primeSpeech: () => void
  languages: readonly string[]
}
