import type { TripDetails, TripPlan } from '@antler/schema'
import type { TripInput } from '@antler/trip'

// POST /api/trips の UseCase の入出力。

export type CreateTripInput = {
  /** 端末が「決める」を押すごとに作る UUID（R8） */
  idempotencyKey: string
  /** 検証済みの A-1 の入力（route が TripInputSchema で確かめたもの） */
  trip: TripInput
}

export type CreateTripOutput = {
  plan: TripPlan
  details: TripDetails
  /** 所有者トークン。レスポンスにだけ載せ、保存するのはハッシュ（R7） */
  ownerToken: string
  /** 同じ冪等キーの 2 回目で、保存済みの旅を返した */
  replayed: boolean
}
