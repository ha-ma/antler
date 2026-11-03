// 冪等キーの行（docs/specs/plan-trip/resilience.md「Concurrency / Idempotency」）。
// キーそのものは保存せず、ハッシュ（keyHash）で持つ。

export type TripRequestStatus = 'pending' | 'done' | 'failed'

export type TripRequest = {
  keyHash: string
  bodyHash: string
  status: TripRequestStatus
  tripId: string | null
  /** 作った時刻（ms）。24 時間を過ぎたキーは無視する */
  createdAtMs: number
  /** 最後に状態を変えた時刻（ms）。pending が 2 分を過ぎたら作り直せる */
  updatedAtMs: number
}
