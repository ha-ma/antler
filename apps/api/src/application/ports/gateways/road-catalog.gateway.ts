import type { RoadCatalog } from '@antler/trip'
import type { ZoneCollection } from '@antler/zones'

// その日の行程を計算するための同梱データ（docs/specs/brief-map/functional.md R1・R3）。
// ルート（routes.json、開発時に OSRM から取ったもの）と鹿ゾーン DB。実行時に外部へ通信しない。

export type DayData = { roads: RoadCatalog; zones: ZoneCollection }

export interface RoadCatalogGateway {
  load(): DayData
}
