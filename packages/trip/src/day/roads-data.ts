import routesJson from '../../data/routes.json'
import { RoadCatalogSchema, type RoadCatalog } from './roads'

// 同梱のルートのデータ（`@antler/trip/roads`）。数百 KB あるので、`@antler/trip` の入口からは export しない。
// 読むのは api だけ（画面は api の応答の線を描く。初回読込 3 秒の NFR）。

export const ROAD_CATALOG: RoadCatalog = RoadCatalogSchema.parse(routesJson)
