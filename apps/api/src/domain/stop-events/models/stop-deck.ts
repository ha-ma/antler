import type { LocalizedText } from '../../trips/models/trip-writing.js'

// 出来事の束（docs/specs/stop-events/functional.md R2〜R6）。純粋な型だけ。
// 束は旅程から決定的に計算する（時刻・鹿ゾーン・失うもの）。Claude の文は StopWriting に分ける（R1）。

/** その時刻・地点の光（@antler/zones の LightPeriod と同じ文字列） */
export type Light = 'dawn' | 'day' | 'dusk' | 'night'

export const SCENE_KINDS = ['pleasure', 'fuel', 'traffic', 'weather', 'request'] as const
export type SceneKind = (typeof SCENE_KINDS)[number]
export type RandomSceneKind = Exclude<SceneKind, 'pleasure'>

export const CHOICE_KINDS = [
  'leave',
  'linger',
  'stay',
  'refuel',
  'skip',
  'wait',
  'bypass',
  'turn-back',
  'slow',
  'wait-out',
  'accept',
  'decline',
] as const
export type ChoiceKind = (typeof CHOICE_KINDS)[number]

/** 場面を出す場所。stop は「leg 番目の移動の前に止まっている」、road は「leg 番目の移動の km 地点」 */
export type SceneTrigger =
  { kind: 'stop'; beforeLeg: number } | { kind: 'road'; leg: number; km: number }

export type ZoneAhead = {
  /** 鹿ゾーンの入口の時刻（遅れを足した後、+09:00 の ISO） */
  entryAt: string
  light: Light
  /** 区間の長さ */
  km: number
  roadName: LocalizedText
  /** その場面の後に残る鹿ゾーンの数（ここに出すのは一番暗いもの） */
  count: number
}

export type Arrival = { place: string; at: string }

export type SceneChoice = {
  id: string
  kind: ChoiceKind
  delayMin: number
  /** ここで泊まり、その日の残りの移動をしない */
  endsDay: boolean
  stayAt: string | null
  arrive: Arrival | null
  /** その後で通る鹿ゾーンのうち一番暗いもの（しおりどおりの予定）。通らないなら null */
  zone: ZoneAhead | null
  /** lateReturn: 最終日に返却の 1 時間前を過ぎる */
  lost: { jpy: number; weight: number; pleasures: string[]; lateReturn: boolean }
}

export type StopScene = {
  id: string
  kind: SceneKind
  trigger: SceneTrigger
  /** 場面の時刻（+09:00 の ISO） */
  at: string
  pleasure: { id: string; weight: number; base: string } | null
  stayMin: number | null
  spentJPY: number | null
  /** その日の最後の到着（予定どおりのとき）。移動が残っていなければ null */
  arrive: Arrival | null
  choices: SceneChoice[]
}

export type StopDeck = {
  tripId: string
  day: number
  date: string
  /** 1 日あたりの予算（宿と食事。予算 × 人数 ÷ 日数を 1,000 円単位） */
  dayBudgetJPY: number
  scenes: StopScene[]
  /** 結果を決めたデータの版（DayPlan の data） */
  data: { routes: string; zones: string }
}
