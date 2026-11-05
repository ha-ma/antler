import type { CollisionDescriptor } from '../../../domain/losses/models/loss.js'
import type { LocalizedText } from '../../../domain/trips/models/trip-writing.js'

// POST /api/trips/:id/losses の UseCase の入出力（docs/specs/loss/functional.md「API エンドポイント」）。

export type WriteLossInput = { tripId: string; collision: CollisionDescriptor }

export type WriteLossOutput = {
  loss: { tripId: string; story: LocalizedText; createdAt: string }
  /** 保存済みの文を返した（200）。新しく作った（201）なら false */
  replayed: boolean
}
