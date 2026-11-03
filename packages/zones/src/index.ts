// @antler/zones — 鹿ゾーン DB（GeoJSON）と、ゾーン判定・ルート沿いの距離・光の区分・危険度・位置の丸め。
// A（地図・3D・イベント）と B（スマホの GPS）が同じファイルと同じ関数を使う。仕様: docs/specs/zones/functional.md
export {
  distanceToPolyline,
  HOKKAIDO_BBOX,
  inHokkaido,
  metersBetween,
  polylineLengthM,
  type LonLat,
} from './geo'
export {
  ENTER_M,
  ETA_MIN_KMH,
  EXIT_M,
  judgeZone,
  POOR_ACCURACY_M,
  STALE_MS,
  toGpsZone,
  type Fix,
  type RoadName,
  type ZoneJudgement,
} from './judge'
export {
  measureAlongRoute,
  planRoute,
  ROUTE_MERGE_GAP_M,
  type RouteInterval,
  type RouteMeasure,
  type RoutePlan,
} from './route'
export { lightPeriod, sunAltitude, toInstant, type Where } from './sun'
export { jstMonth, zoneRisk } from './risk'
export { SEGMENT_SNAP_M, toRoadSegment } from './road-segment'
export {
  LIGHT_PERIODS,
  ZONE_ID,
  ZoneCollectionSchema,
  type LightPeriod,
  type ZoneCollection,
  type ZoneFeature,
  type ZoneProperties,
} from './zone-db'
export { parseZoneCollection, ZONES_GEOJSON_URL } from './data'
