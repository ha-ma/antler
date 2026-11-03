// plan-trip のテスト用のフェイクとビルダー（docs/specs/plan-trip/functional.md の Test List）。
// 本番の DI では使わない（threat.md「開発バイパス」）。

import type {
  TripWriterGateway,
  TripWriterOutcome,
  TripWriterRequest,
} from '../../src/application/ports/gateways/trip-writer.gateway.js'
import type {
  StoredTrip,
  TripRepository,
} from '../../src/application/ports/repositories/trip.repository.js'
import type { RandomSource } from '../../src/application/ports/security/random-source.js'
import type { Clock } from '../../src/application/ports/system/clock.js'
import type { EventFields, EventLog } from '../../src/application/ports/system/event-log.js'
import type {
  TransactionalRepositories,
  UnitOfWork,
} from '../../src/application/ports/unit-of-work.js'
import { TripIdCollisionError } from '../../src/domain/trips/errors/trip-errors.js'
import type { TripRequest, TripRequestStatus } from '../../src/domain/trips/models/trip-request.js'
import type { TripWriting, TripWritingBrief } from '../../src/domain/trips/models/trip-writing.js'

export const KEY_A = '0b6f6f0e-4f7e-4b0e-9a57-2f1d8f3c9a01'
export const KEY_B = '7d1c2e55-8b8a-4c3f-b1d2-5e6f7a8b9c02'

/** 検証を通る文（各日は brief の days から作る） */
export function validWriting(brief: {
  days: readonly Pick<TripWritingBrief['days'][number], 'day'>[]
}): TripWriting {
  return {
    titles: {
      ja: '流氷とタンチョウの道東の旅',
      en: 'Drift ice and cranes in Eastern Hokkaido',
      zh: '流冰與丹頂鶴的道東之旅',
      ko: '유빙과 두루미의 도토 여행',
    },
    dayNotes: brief.days.map((d) => ({
      day: d.day,
      note: {
        ja: `D${String(d.day)} 雪原を走る日。夕暮れは速度を落として鹿に注意`,
        en: `Day ${String(d.day)}: snowy roads. Slow down at dusk and watch for deer`,
        zh: `第${String(d.day)}天 雪原之路。黃昏請減速留意鹿`,
        ko: `${String(d.day)}일차 눈길 드라이브. 해 질 녘에는 속도를 줄이세요`,
      },
    })),
  }
}

type Step =
  'valid' | TripWriterOutcome | Error | ((request: TripWriterRequest) => TripWriterOutcome)

/** 決めた順に応える Claude のフェイク。手順が尽きたら valid を返す */
export class ScriptedWriter implements TripWriterGateway {
  readonly calls: TripWriterRequest[] = []
  constructor(private readonly steps: Step[] = []) {}

  write(request: TripWriterRequest): Promise<TripWriterOutcome> {
    this.calls.push(request)
    const step = this.steps.shift() ?? 'valid'
    if (step instanceof Error) return Promise.reject(step)
    if (step === 'valid') {
      return Promise.resolve({ kind: 'draft', writing: validWriting(request.brief) })
    }
    if (typeof step === 'function') return Promise.resolve(step(request))
    return Promise.resolve(step)
  }
}

/** 呼ばれるたびに決めたバイトで埋めた配列を返す（尽きたら連番） */
export class ScriptedRandom implements RandomSource {
  private counter = 100
  constructor(private readonly fills: number[] = []) {}
  bytes(n: number): Uint8Array {
    const fill = this.fills.shift()
    if (fill !== undefined) return new Uint8Array(n).fill(fill)
    return Uint8Array.from({ length: n }, () => this.counter++ % 248)
  }
}

export class FixedClock implements Clock {
  constructor(public t: number) {}
  nowMs(): number {
    return this.t
  }
}

export class MemoryLog implements EventLog {
  readonly events: { level: string; event: string; fields: EventFields }[] = []
  info(event: string, fields: EventFields = {}): void {
    this.events.push({ level: 'info', event, fields })
  }
  warn(event: string, fields: EventFields = {}): void {
    this.events.push({ level: 'warn', event, fields })
  }
  error(event: string, fields: EventFields = {}): void {
    this.events.push({ level: 'error', event, fields })
  }
  has(event: string): boolean {
    return this.events.some((e) => e.event === event)
  }
}

/** メモリの TripRepository。insertTrip / markRequestDone を失敗させられる */
export class InMemoryTripRepository implements TripRepository {
  requests = new Map<string, TripRequest>()
  trips = new Map<string, StoredTrip>()
  /** 日の始まり（ms）ごとの Claude の呼び出しの数 */
  writerCalls = new Map<number, number>()
  failInsertTrip: Error | null = null

  insertPendingRequest(row: { keyHash: string; bodyHash: string; nowMs: number }) {
    if (this.requests.has(row.keyHash)) return Promise.resolve(false)
    this.requests.set(row.keyHash, {
      keyHash: row.keyHash,
      bodyHash: row.bodyHash,
      status: 'pending',
      tripId: null,
      createdAtMs: row.nowMs,
      updatedAtMs: row.nowMs,
    })
    return Promise.resolve(true)
  }
  findRequest(keyHash: string) {
    const r = this.requests.get(keyHash)
    return Promise.resolve(r ? { ...r } : null)
  }
  reclaimRequest(
    keyHash: string,
    expected: { status: TripRequestStatus; updatedAtMs: number },
    next: { bodyHash: string; nowMs: number },
  ) {
    const r = this.requests.get(keyHash)
    if (!r || r.status !== expected.status || r.updatedAtMs !== expected.updatedAtMs) {
      return Promise.resolve(false)
    }
    this.requests.set(keyHash, {
      ...r,
      bodyHash: next.bodyHash,
      status: 'pending',
      tripId: null,
      createdAtMs: next.nowMs,
      updatedAtMs: next.nowMs,
    })
    return Promise.resolve(true)
  }
  markRequestFailed(keyHash: string, nowMs: number) {
    const r = this.requests.get(keyHash)
    if (r?.status === 'pending') {
      this.requests.set(keyHash, { ...r, status: 'failed', tripId: null, updatedAtMs: nowMs })
    }
    return Promise.resolve()
  }
  markRequestDone(keyHash: string, tripId: string, nowMs: number) {
    const r = this.requests.get(keyHash)
    if (r) this.requests.set(keyHash, { ...r, status: 'done', tripId, updatedAtMs: nowMs })
    return Promise.resolve()
  }
  insertTrip(trip: StoredTrip) {
    if (this.failInsertTrip) return Promise.reject(this.failInsertTrip)
    if (this.trips.has(trip.plan.id)) return Promise.reject(new TripIdCollisionError())
    this.trips.set(trip.plan.id, trip)
    return Promise.resolve()
  }
  findTrip(id: string) {
    return Promise.resolve(this.trips.get(id) ?? null)
  }
  countWriterCall(dayStartMs: number) {
    const calls = (this.writerCalls.get(dayStartMs) ?? 0) + 1
    this.writerCalls.set(dayStartMs, calls)
    return Promise.resolve(calls)
  }
}

/** 投げたら中身を元に戻す UnitOfWork（InMemoryTripRepository 用） */
export class InMemoryUnitOfWork implements UnitOfWork {
  constructor(private readonly repo: InMemoryTripRepository) {}
  async transaction<T>(fn: (repos: TransactionalRepositories) => Promise<T>): Promise<T> {
    const requests = new Map(this.repo.requests)
    const trips = new Map(this.repo.trips)
    try {
      return await fn({ trips: this.repo })
    } catch (error) {
      this.repo.requests = requests
      this.repo.trips = trips
      throw error
    }
  }
}
