import type { LocalizedText, TripDetails, TripPlan } from '@antler/schema'
import type { DayPlan } from '@antler/trip'
import type { LightPeriod } from '@antler/zones'

// loss（A-6 喪失）の型。仕様: docs/specs/loss/functional.md
//
// State 設計:
// - URL の状態: 衝突の情報（/loss/:tripId?day&leg&at&speed&light&side&stops&t(&alert=off)）→ parseCollision。
//   再読み込み・別タブで同じ画面になる（R1）。store・location state は使わない
// - サーバーの状態: その日の行程（GET /api/trips/:id/day/:n）→ TanStack Query（useLossTripDay）
//   喪失文（POST /api/trips/:id/losses。内容で冪等）→ TanStack Query の useQuery（useLossStory、retry: false）
// - 派生: 取り消し線の行（strikeItinerary）と 4 指標（assessLoss）は描画のたびに純粋関数で決める
// - Zustand・useState は使わない（画面の中で変わる状態が無い）

/** drive から A-6 に渡す衝突の情報（R1。drive-link との契約。変えたら loss-handover.md も直す） */
export type CollisionReport = {
  /** TripPlan.id */
  tripId: string
  /** 1 始まりの日 */
  day: number
  /** その日の DayPlan.legs の添字（0 始まり） */
  leg: number
  /** 衝突の時刻（ISO 8601、+09:00）。JST の暦日はその日の日付と同じ */
  at: string
  /** 衝突時の速さ（0〜199 の整数） */
  speedKmh: number
  /** 衝突地点・時刻の光 */
  light: LightPeriod
  /** 鹿が出た側（車から見て） */
  side: 'L' | 'R'
  /** その走行のアラート ON / OFF */
  alertEnabled: boolean
  /** その日に済ませた楽しみの id。無ければ [] */
  achievedStops: string[]
  /** シミュレーションの経過（World.t、ms。巻き戻し用） */
  simMs: number
}

/** GET /api/trips/:id/day/:n の応答 */
export type TripDay = { plan: TripPlan; details: TripDetails; day: DayPlan }

/** POST /api/trips/:id/losses の応答の loss */
export type Loss = { tripId: string; story: LocalizedText; createdAt: string }

/** 喪失の計算に使う単価（data/loss-baseline.json。出典が無い概算） */
export type LossBaseline = {
  verified: boolean
  note: string
  lodgingPerPersonNightJPY: number
  experiencePerPersonJPY: number
}
