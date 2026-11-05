import type { Lang } from '@antler/schema'

// stop-events（A-4 観光スポット・Claude の出来事の文・イベントログ）の型。仕様: docs/specs/stop-events/functional.md
// api の `POST /api/trips/:id/day/:n/stop-deck` と `POST /api/trips/:id/events` の形と同じ（凍結 API の外。R10）。
//
// State 設計:
// - サーバーの状態: その日の束（POST stop-deck。旅と日で決まる）→ TanStack Query（useStopDeck、staleTime: Infinity）
// - 送るだけの状態: イベントの seq と送信待ち → TripEventSender（useTripEventLog が 1 つ持つ。runId と seq はメモリだけ。R12）
// - UI の状態: 確認用の画面で開いている場面と、選んだ結果 → useState（2 つ）
// - Zustand は使わない（feature をまたいで共有する状態が無い。運転側は onChoose で受け取る）

export type Light = 'dawn' | 'day' | 'dusk' | 'night'
export type SceneKind = 'pleasure' | 'fuel' | 'traffic' | 'weather' | 'request'
export type ChoiceKind =
  | 'leave'
  | 'linger'
  | 'stay'
  | 'refuel'
  | 'skip'
  | 'wait'
  | 'bypass'
  | 'turn-back'
  | 'slow'
  | 'wait-out'
  | 'accept'
  | 'decline'

export type Localized = Record<Lang, string>

export type SceneTrigger =
  { kind: 'stop'; beforeLeg: number } | { kind: 'road'; leg: number; km: number }

export type ZoneAhead = {
  entryAt: string
  light: Light
  km: number
  roadName: Localized
  count: number
}

export type Arrival = { place: string; at: string }

export type SceneChoice = {
  id: string
  kind: ChoiceKind
  delayMin: number
  endsDay: boolean
  stayAt: string | null
  arrive: Arrival | null
  zone: ZoneAhead | null
  lost: { jpy: number; weight: number; pleasures: string[]; lateReturn: boolean }
}

export type StopScene = {
  id: string
  kind: SceneKind
  trigger: SceneTrigger
  at: string
  pleasure: { id: string; weight: number; base: string } | null
  stayMin: number | null
  spentJPY: number | null
  arrive: Arrival | null
  choices: SceneChoice[]
}

export type StopDeck = {
  tripId: string
  day: number
  date: string
  dayBudgetJPY: number
  scenes: StopScene[]
  data: { routes: string; zones: string }
}

export type SceneWriting = {
  id: string
  headline: Localized
  body: Localized
  choices: { id: string; label: Localized; note: Localized }[]
}

export type StopWriting = { scenes: SceneWriting[] }

/** 束の POST の応答 */
export type StopDeckResponse = { deck: StopDeck; writing: StopWriting }

export type DeerPattern = 'roadside' | 'eyeshine' | 'crossing' | 'herd' | 'frozen'

type EventBase = { day: number; at: string; leg?: number; km?: number }

/** 運転（drive-link・loss）が残すイベント。seq は useTripEventLog が振る（R10） */
export type TripEventDraft =
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

/** 選んだ結果（運転に返す。R12。遅れと泊まるかを運転の時計に反映するのは drive-link） */
export type SceneChoiceResult = { scene: StopScene; choice: SceneChoice }
