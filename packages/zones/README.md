# @antler/zones — 鹿ゾーン DB と判定

鹿ゾーン DB（`data/zones.geojson`）と、それを使う純粋関数。A（地図・3D・イベント）と B（スマホの GPS）が同じファイル・同じ関数を使う。
仕様: [docs/specs/zones/functional.md](../../docs/specs/zones/functional.md)

## 使い方

| 関数                                                            | 使う側             | 何をするか                                                                                                             |
| --------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `judgeZone({ fix, now, previous, zones })`                      | B（毎回の測位）・A | ゾーンの内外（150 m で入り 200 m を超えて出る）、残り / 次までの km、路線名、到達予定、`enterZone`、測位の途切れの通過 |
| `toGpsZone(judgement)`                                          | B・A               | `@antler/alert-ui` の `deriveAlertState` に渡す形に直す                                                                |
| `planRoute(route, zones)` → `measureAlongRoute(plan, position)` | A                  | その日のルート沿いの次のゾーンまでと残り km。`planRoute` はルートごとに 1 回                                           |
| `lightPeriod(at, { lat, lon })`                                 | A-4・A-5・Capture  | 太陽の高さで dawn / day / dusk / night。時刻はタイムゾーン付きで渡す                                                   |
| `zoneRisk(zone, at)`                                            | A-5                | 0〜1 の危険度（JST の月 × 光の区分）                                                                                   |
| `toRoadSegment(position, zones)`                                | Capture            | ゾーンから 1 km 以内はゾーン id、それ以外は `unknown`（精密な位置を残さない）                                          |
| `parseZoneCollection(text)`・`ZONES_GEOJSON_URL`                | A・B               | 同梱のファイルを読み、形を確かめる                                                                                     |

## 読み違えないために

- **緑（ゾーン外）は「安全」ではない。** 初版のゾーンは北海道開発局の地図に名前が出ている国道の区間だけで、道道・市町村道は調べていない
- 各ゾーンの `confidence`（high / medium / low）は、地図の段階の読み取りと区間の位置の確からしさ。low のゾーンも表示する
- ゾーンの位置と長さが現地の感覚と合っているかは、調査走行（Day 4）で確かめる（仕様の Deferred）

## データの作り方

`data/zones.waypoints.json`（区間の始点・終点を人が置く）→ `scripts/resolve-centerlines.ts`（国道の中心線をたどる）→
`data/zones.source.json` → `npm run build:zones -w @antler/zones` → `data/zones.geojson`。
生成物を手で直さない。道路データの取得方法と利用条件は [data/README.md](data/README.md)。出典は [CREDITS.md](../../CREDITS.md)。
