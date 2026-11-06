// loss のテスト用のフェイクとビルダー（docs/specs/loss/functional.md の Test List）。
// 本番の DI では使わない。

import { TripDetailsSchema, TripPlanSchema, type TripPlan } from '@antler/schema'
import { assessRisk, buildItinerary, buildTripPlan, PERSONA_INPUT } from '@antler/trip'
import type {
  LossWriterGateway,
  LossWriterOutcome,
  LossWriterRequest,
} from '../../src/application/ports/gateways/loss-writer.gateway.js'
import type { LossRepository } from '../../src/application/ports/repositories/loss.repository.js'
import type { StoredTrip } from '../../src/application/ports/repositories/trip.repository.js'
import type {
  CollisionDescriptor,
  LossStory,
  StoredLoss,
} from '../../src/domain/losses/models/loss.js'

export const PERSONA_TRIP_ID = 'K7m2abcd'
export const OWNER_HASH = 'f'.repeat(64)

/**
 * このテストの旅の入力: ペルソナの日程で、楽しみは流氷ウォークとタンチョウの 2 つ。
 * PERSONA_INPUT は plan-trip-photos で夜のアイヌコタンを足したので、場面を固定するためにここで明示する。
 */
const STORY_INPUT = {
  ...PERSONA_INPUT,
  pleasures: [{ id: 'drift-ice-walk' }, { id: 'red-crowned-crane' }],
}

/** 保存済みのペルソナの旅（5 日。D2 は鶴居 → 知床の移動 1 本、タンチョウは鶴居） */
export function personaTrip(id = PERSONA_TRIP_ID): StoredTrip {
  const itinerary = buildItinerary(STORY_INPUT)
  const plan: TripPlan = TripPlanSchema.parse(
    buildTripPlan(STORY_INPUT, itinerary, assessRisk(STORY_INPUT, itinerary), {
      id,
      seed: 918273,
      title: '流氷とタンチョウ',
    }),
  )
  const note = { ja: '移動', en: 'Drive', zh: '移動', ko: '이동' }
  const details = TripDetailsSchema.parse({
    tripId: id,
    titles: { ja: '流氷とタンチョウ', en: 'Drift ice', zh: '流冰', ko: '유빙' },
    dayNotes: plan.days.map((d) => ({ day: d.day, note })),
    skipped: [],
    createdAt: '2026-11-03T12:00:00+09:00',
  })
  return { plan, details, ownerTokenHash: OWNER_HASH, createdAtMs: 0 }
}

/** ペルソナの D2（2027-02-15）の移動で、タンチョウを済ませたあと OFF で衝突 */
export const PERSONA_COLLISION: CollisionDescriptor = {
  day: 2,
  leg: 0,
  at: '2027-02-15T16:31:00+09:00',
  alertEnabled: false,
  achievedStops: ['red-crowned-crane'],
}

/** 検証を通る喪失文 */
export function validStory(): LossStory {
  return {
    story: {
      ja: '鶴居のタンチョウは見られた。けれど知床の流氷も、四人で見るはずの景色も、次の機会になった。',
      en: 'You saw the cranes in Tsurui, but the drift ice of Shiretoko will have to wait.',
      zh: '鶴居的丹頂鶴看到了，但知床的流冰，只能留待下次。',
      ko: '쓰루이의 두루미는 보았지만, 시레토코의 유빙은 다음 기회로 미뤄졌습니다.',
    },
  }
}

type Step =
  'valid' | LossWriterOutcome | Error | ((request: LossWriterRequest) => LossWriterOutcome)

/** 決めた順に応える Claude のフェイク。手順が尽きたら valid を返す。gate を渡すと、それが解けるまで応えない */
export class ScriptedLossWriter implements LossWriterGateway {
  readonly calls: LossWriterRequest[] = []
  constructor(
    private readonly steps: Step[] = [],
    private readonly gate: Promise<void> = Promise.resolve(),
  ) {}

  async write(request: LossWriterRequest): Promise<LossWriterOutcome> {
    this.calls.push(request)
    const step = this.steps.shift() ?? 'valid'
    await this.gate
    if (step instanceof Error) throw step
    if (step === 'valid') return { kind: 'draft', output: validStory() }
    if (typeof step === 'function') return step(request)
    return step
  }
}

/** メモリの LossRepository。insertLoss を負けさせられる（別プロセスが先に保存した） */
export class InMemoryLossRepository implements LossRepository {
  losses = new Map<string, StoredLoss>()
  /** 次の insertLoss の直前に、この行を先に入れておく（CONC-1） */
  raceWith: StoredLoss | null = null
  failInsert: Error | null = null

  findLoss(keyHash: string) {
    return Promise.resolve(this.losses.get(keyHash) ?? null)
  }
  countLosses(tripId: string) {
    return Promise.resolve([...this.losses.values()].filter((l) => l.tripId === tripId).length)
  }
  insertLoss(loss: StoredLoss) {
    if (this.failInsert) return Promise.reject(this.failInsert)
    if (this.raceWith) {
      this.losses.set(this.raceWith.keyHash, this.raceWith)
      this.raceWith = null
    }
    if (this.losses.has(loss.keyHash)) return Promise.resolve(false)
    this.losses.set(loss.keyHash, loss)
    return Promise.resolve(true)
  }
}
