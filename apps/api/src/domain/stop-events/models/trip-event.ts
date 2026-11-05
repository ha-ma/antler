import type { ChoiceKind, Light, SceneKind } from './stop-deck.js'

// イベントログ（docs/specs/stop-events/functional.md R10、ch7 `POST /api/trips/{id}/events`）。純粋な型だけ。
// record・loss・drive-link が同じ形を使う。位置は leg・km だけで持ち、緯度経度を持たない。

export const DEER_PATTERNS = ['roadside', 'eyeshine', 'crossing', 'herd', 'frozen'] as const
export type DeerPattern = (typeof DEER_PATTERNS)[number]

export const TRIP_EVENT_KINDS = ['choice', 'encounter', 'collision', 'avoidance'] as const
export type TripEventKind = (typeof TRIP_EVENT_KINDS)[number]

type EventBase = {
  seq: number
  day: number
  /** ゲーム内の時刻（タイムゾーン付き ISO 8601） */
  at: string
  leg?: number | undefined
  km?: number | undefined
}

/** 端末から受けるイベント（検証後） */
export type TripEventInput =
  | (EventBase & { kind: 'choice'; sceneId: string; choiceId: string })
  | (EventBase & {
      kind: 'encounter'
      pattern: DeerPattern
      alerted: boolean
      alertDistanceM: number | null
      userSpotted: boolean
    })
  | (EventBase & { kind: 'collision'; pattern: DeerPattern; speedKmh: number })
  | (EventBase & {
      kind: 'avoidance'
      pattern: DeerPattern
      closestM: number
      alertToBrakeMs: number | null
    })

/** choice の行に写す束の値（端末の値を信じない） */
export type ResolvedChoice = {
  sceneId: string
  choiceId: string
  sceneKind: SceneKind
  choiceKind: ChoiceKind
  delayMin: number
  endsDay: boolean
  /** しおりどおりに走った場合の光（R1） */
  plannedLight: Light | null
  lostJPY: number
  lostWeight: number
  lostPleasures: string[]
  lateReturn: boolean
}

export type TripEventData =
  | ResolvedChoice
  | { pattern: DeerPattern; alerted: boolean; alertDistanceM: number | null; userSpotted: boolean }
  | { pattern: DeerPattern; speedKmh: number }
  | { pattern: DeerPattern; closestM: number; alertToBrakeMs: number | null }

/** 保存する行（record が listByTrip で読む） */
export type TripEventRecord = {
  tripId: string
  runId: string
  seq: number
  day: number
  kind: TripEventKind
  at: string
  alertEnabled: boolean
  leg: number | null
  km: number | null
  data: TripEventData
  /** 受けた時刻（ms） */
  receivedAtMs: number
}
