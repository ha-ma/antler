import type { TransactionalRepositories, UnitOfWork } from '../../application/ports/unit-of-work.js'
import { DrizzleTripRepository } from '../repositories/drizzle-trip.repository.js'
import type { Database } from './connection.js'

// db.transaction を包む。fn が投げたら戻し、返ったら確定する。

export class DrizzleUnitOfWork implements UnitOfWork {
  constructor(private readonly db: Database) {}

  transaction<T>(fn: (repos: TransactionalRepositories) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn({ trips: new DrizzleTripRepository(tx) }))
  }
}
