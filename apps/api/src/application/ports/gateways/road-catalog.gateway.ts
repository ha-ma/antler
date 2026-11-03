import type { RoadCatalog } from '@antler/trip'
import type { ZoneCollection } from '@antler/zones'

// その日の行程を計算するための同梱データ（docs/specs/brief-map/functional.md R1・R3）。
// ルート（routes.json、開発時に OSRM から取ったもの）と鹿ゾーン DB。実行時に外部へ通信しない。
// Gateway は外部 transport 用だが、同梱データ（ファイル）の読み込みもここに置く例外（UseCase をファイル・Node の API から切り離すため。
// 実装 infrastructure/gateways/file-road-catalog.gateway.ts は Node の fs を使うので、Workers で動かすときは別の実装にする）。

export type DayData = { roads: RoadCatalog; zones: ZoneCollection }

export interface RoadCatalogGateway {
  load(): DayData
}
