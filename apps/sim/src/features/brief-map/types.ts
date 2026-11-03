import type { TripDetails, TripPlan } from '@antler/schema'
import type { DayPlan } from '@antler/trip'

// brief-map（A-2 出発前ブリーフィング）の型。仕様: docs/specs/brief-map/functional.md
//
// State 設計:
// - サーバーの状態: その日の行程（GET /api/trips/:id/day/:n）→ TanStack Query（useTripDay）
// - URL の状態: 日（?day=n）とアラートの ON/OFF（?alert=off）→ useSearchParams（useBriefParams）。再読み込み・A-6 から戻ったときに同じ
// - 外部のシステム: 地図の背景（MapLibre）と投影 → useBaseMap の中の useState（mode と投影）
// - Zustand は使わない（feature をまたいで共有する状態が無い）

/** GET /api/trips/:id/day/:n の応答 */
export type TripDay = { plan: TripPlan; details: TripDetails; day: DayPlan }
