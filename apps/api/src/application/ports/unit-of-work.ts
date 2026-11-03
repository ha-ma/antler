import type { TripRepository } from './repositories/trip.repository.js'

// トランザクション境界。fn が投げたら戻し、返ったら確定する（commit / rollback は実装の責務）。

export type TransactionalRepositories = { trips: TripRepository }

export interface UnitOfWork {
  transaction<T>(fn: (repos: TransactionalRepositories) => Promise<T>): Promise<T>
}
