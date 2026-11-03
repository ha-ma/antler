import { parseZoneCollection } from '@antler/zones'
import raw from '@antler/zones/zones.geojson?raw'

// 鹿ゾーン DB（packages/zones/data/zones.geojson）をビルドに同梱して読む（74 KB）。
// A でも B と同じファイルを使う（zones の仕様 R1）。brief-map が /api/zones.geojson を配るようになっても、運転中は同梱のものを使う。
export const ZONES = parseZoneCollection(raw)
