import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { ROAD_CATALOG } from '@antler/trip/roads'
import { parseZoneCollection } from '@antler/zones'
import type {
  DayData,
  RoadCatalogGateway,
} from '../../application/ports/gateways/road-catalog.gateway.js'

// 同梱データの読み込み（docs/specs/brief-map/functional.md R1・R3）。起動時に 1 回だけ読んで形を確かめ、以後は同じものを返す。
// ルートは @antler/trip/roads（routes.json）、鹿ゾーンは @antler/zones の zones.geojson（B と同じファイル）。

const require = createRequire(import.meta.url)

export class FileRoadCatalogGateway implements RoadCatalogGateway {
  private readonly data: DayData

  constructor() {
    const zonesPath = require.resolve('@antler/zones/zones.geojson')
    this.data = { roads: ROAD_CATALOG, zones: parseZoneCollection(readFileSync(zonesPath, 'utf8')) }
  }

  load(): DayData {
    return this.data
  }
}
