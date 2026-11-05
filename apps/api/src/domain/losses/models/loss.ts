import type { LocalizedText, TripLang } from '../../trips/models/trip-writing.js'

// 喪失（A-6）の型。docs/specs/loss/functional.md R5〜R7。純粋な型だけ。

/** 衝突の記述子（POST /api/trips/:id/losses の body）。保存の鍵はこの正規化（R6） */
export type CollisionDescriptor = {
  /** 1 始まりの日 */
  day: number
  /** その日の移動の添字（0 始まり） */
  leg: number
  /** 衝突の時刻（タイムゾーン付きの ISO 8601） */
  at: string
  alertEnabled: boolean
  /** その日に済ませた楽しみの id */
  achievedStops: string[]
}

/** 保存したしおりの 1 日（地名・楽しみの名前はマスターの 4 言語）。usecase が @antler/trip から作る */
export type LossDayContext = {
  day: number
  /** JST の暦日（YYYY-MM-DD） */
  date: string
  /** その日の移動（しおりの組み立ての legs と同じ順） */
  legs: { fromId: string; from: LocalizedText; to: LocalizedText }[]
  /** base は楽しみの拠点の地点 id（達成できるかの判定に使う） */
  stops: { id: string; base: string; name: LocalizedText }[]
  /** その夜の宿の町。最終日は null */
  stay: LocalizedText | null
}

/**
 * Claude に渡す材料。すべてマスターの名前と選択肢由来の値で、自由入力・統計の数字・金額・道路番号を含まない（UC-5a）。
 */
export type LossBrief = {
  lang: TripLang
  partySize: number
  totalDays: number
  collisionDay: number
  /** 衝突した日から最終日まで（N − day + 1） */
  lostDays: number
  /** 衝突した移動の出発地と行き先 */
  collisionLeg: { from: LocalizedText; to: LocalizedText }
  /** 達成した楽しみ（衝突より前の日 ＋ その日に済ませたもの） */
  achieved: LocalizedText[]
  /** 失った楽しみ（しおりの順） */
  lost: LocalizedText[]
  /** 失った宿の町（衝突した日以降の stay。しおりの順、重複なし） */
  lostStays: LocalizedText[]
  alertEnabled: boolean
}

/** Claude の出力（検証前）。「失ったもの」の文（1〜3 文、4 言語） */
export type LossStory = { story: LocalizedText }

export type StoredLoss = {
  keyHash: string
  tripId: string
  collision: CollisionDescriptor
  story: LocalizedText
  createdAtMs: number
}
