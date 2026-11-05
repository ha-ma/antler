import type { StoredLoss } from '../../../domain/losses/models/loss.js'

// 喪失文の保存（docs/specs/loss/resilience.md「トランザクション境界」）。実装は infrastructure/repositories/。

export interface LossRepository {
  findLoss(keyHash: string): Promise<StoredLoss | null>
  /** その旅に保存した喪失文の数（1 つの旅の上限に使う） */
  countLosses(tripId: string): Promise<number>
  /** 保存する。同じ鍵の行が既にあれば false（主キーで片方だけが通る。CONC-1） */
  insertLoss(loss: StoredLoss): Promise<boolean>
}
