import type { ChoiceKind, RandomSceneKind } from '../models/stop-deck.js'

// 出来事の束・Claude の文・イベントログの定数（docs/specs/stop-events/functional.md）。

/** 重さ 1 あたりの滞在（plan-trip の HOURS_PER_WEIGHT 1.6 時間と同じ） */
export const MINUTES_PER_WEIGHT = 96
/** ランダムの出来事の間隔（経験ごと。R2「2〜3 時間に 1 回」） */
export const RANDOM_INTERVAL_MIN = { first: 120, few: 150, experienced: 180 } as const
export const MAX_RANDOM_SCENES = 3
export const MAX_SCENES_PER_DAY = 6
/** ランダムの出来事の時刻の揺らぎ（±分） */
export const RANDOM_JITTER_MIN = 20
/** 鹿ゾーンの中に落ちたランダムの出来事を、入口の何 km 手前に動かすか */
export const ZONE_MARGIN_KM = 1
export const RANDOM_SCENE_KINDS: readonly RandomSceneKind[] = [
  'fuel',
  'traffic',
  'weather',
  'request',
]

/** 選択肢の遅れ（分）。stay・turn-back は泊まる（遅れでは表さない） */
export const CHOICE_DELAY_MIN: Record<ChoiceKind, number> = {
  leave: 0,
  linger: 60,
  stay: 0,
  refuel: 15,
  skip: 0,
  wait: 40,
  bypass: 25,
  'turn-back': 0,
  slow: 30,
  'wait-out': 90,
  accept: 20,
  decline: 0,
}
export const STAY_CHOICES: readonly ChoiceKind[] = ['stay', 'turn-back']

/** 場面の種類ごとの選択肢（並び順のまま出す。泊まる系は条件で外す。R3） */
export const SCENE_CHOICES = {
  pleasure: ['leave', 'linger', 'stay'],
  fuel: ['refuel', 'skip'],
  traffic: ['wait', 'bypass', 'turn-back'],
  weather: ['slow', 'wait-out', 'turn-back'],
  request: ['accept', 'decline'],
} as const satisfies Record<string, readonly ChoiceKind[]>

/** 支出の目安の分母（1 日の活動の時間。R6） */
export const ACTIVITY_DAY_MIN = 600

/** Claude の文の長さ（UTF-16 の単位。R7） */
export const HEADLINE_MAX_LENGTH = 120
export const BODY_MAX_LENGTH = 400
export const LABEL_MAX_LENGTH = 100
export const CHOICE_NOTE_MAX_LENGTH = 120

/** 1 回のイベントの POST の件数・1 つの旅のイベントの上限（R10） */
export const MAX_EVENTS_PER_POST = 50
export const MAX_EVENTS_PER_TRIP = 5000
