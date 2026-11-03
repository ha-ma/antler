import type { Lang } from '@antler/schema'
import type { Area, Experience, TripInput } from '@antler/trip'

type DeparturePlace = TripInput['depart']['place']

// plan-trip（A-1 旅をつくる）の型。仕様: docs/specs/plan-trip/functional.md R1〜R6・R8。

/** 選んだ楽しみと重さ（1〜5）。 */
export type PleasureSelection = { id: string; weight: number }

/** エリアごとの選択（R2: 選択はエリアごとに保持する）。 */
export type SelectionsByArea = Record<Area, PleasureSelection[]>

/**
 * 入力フォームの値（React Hook Form）。日時は `<input type="datetime-local">` の値
 * （`2027-02-14T10:00`。日本時間として読む）。楽しみ・エリア・言語は store が持つ。
 */
export type PlanFormValues = {
  size: number
  drivers: number
  experience: Experience
  departAt: string
  departPlace: DeparturePlace
  returnAt: string
  returnPlace: DeparturePlace
  budget: number
}

/** 4 言語の文言（zh は繁体字）。 */
export type UiText = Record<Lang, string>

/** `/trip/:id/brief` に移るときに渡す state（GET の API ができるまでの受け渡し）。 */
export type BriefLocationState = { titles: Record<Lang, string> }

/** 作成の失敗の種類（画面の文言を分ける）。 */
export type CreateTripFailure = 'limit' | 'failed'
