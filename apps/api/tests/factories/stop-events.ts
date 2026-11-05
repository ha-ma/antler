// stop-events のテスト用のフェイクとビルダー（docs/specs/stop-events/functional.md の Test List）。
// 本番の DI では使わない（threat.md「開発バイパス」）。DB はメモリの SQLite に本物の repository を載せる（sociable）。

import { TripDetailsSchema, type TripDetails, type TripPlan } from '@antler/schema'
import { assessRisk, buildItinerary, buildTripPlan, PERSONA_INPUT } from '@antler/trip'
import type {
  SceneWriterGateway,
  SceneWriterOutcome,
  SceneWriterRequest,
} from '../../src/application/ports/gateways/scene-writer.gateway.js'
import type {
  StopWriting,
  StopWritingBrief,
} from '../../src/domain/stop-events/models/stop-writing.js'
import { openDatabase, type Connection } from '../../src/infrastructure/db/connection.js'
import { ensureSchema } from '../../src/infrastructure/db/migrate.js'
import { FileRoadCatalogGateway } from '../../src/infrastructure/gateways/file-road-catalog.gateway.js'
import { DrizzleStopDeckRepository } from '../../src/infrastructure/repositories/drizzle-stop-deck.repository.js'
import { DrizzleTripEventRepository } from '../../src/infrastructure/repositories/drizzle-trip-event.repository.js'
import { DrizzleTripRepository } from '../../src/infrastructure/repositories/drizzle-trip.repository.js'
import { NodeSha256Hasher } from '../../src/infrastructure/security/node-crypto.js'

export const TRIP_ID = 'K7m2abcd'
export const OWNER_TOKEN = 'a1b2c3d4'.repeat(8)
export const OTHER_TOKEN = 'f0e1d2c3'.repeat(8)
export const RUN_ID = '3f2b8c1e-5d4a-4b6c-9e7f-0a1b2c3d4e5f'
/** 2026-11-04 12:00 JST（1 日の上限の数え上げに使う） */
export const NOW = Date.parse('2026-11-04T12:00:00+09:00')

const hasher = new NodeSha256Hasher()

/** 同梱のルートと鹿ゾーン（読み込みは重いので、テストのあいだ 1 つを使い回す） */
export const ROAD_DATA = new FileRoadCatalogGateway()

/** DayPlan の計算が重いテストの時間切れ（並列で走るとき） */
export const SLOW_TEST_MS = 30_000

/** ペルソナ（台湾から 4 人・2 月・道東・流氷 5・タンチョウ 4）の保存した旅 */
export function personaTrip(): { plan: TripPlan; details: TripDetails } {
  const itinerary = buildItinerary(PERSONA_INPUT)
  const plan = buildTripPlan(PERSONA_INPUT, itinerary, assessRisk(PERSONA_INPUT, itinerary), {
    id: TRIP_ID,
    seed: 918273,
    title: '流氷とタンチョウ',
  })
  const note = { ja: '移動', en: 'Drive', zh: '移動', ko: '이동' }
  const details = TripDetailsSchema.parse({
    tripId: TRIP_ID,
    titles: { ja: '流氷とタンチョウ', en: 'Drift ice', zh: '流冰', ko: '유빙' },
    dayNotes: plan.days.map((d) => ({ day: d.day, note })),
    skipped: [],
    createdAt: '2026-11-03T12:00:00+09:00',
  })
  return { plan, details }
}

export type TestDb = {
  connection: Connection
  trips: DrizzleTripRepository
  decks: DrizzleStopDeckRepository
  events: DrizzleTripEventRepository
}

/** メモリの SQLite に表を作り、ペルソナの旅を保存する（所有者のトークンは OWNER_TOKEN） */
export async function openTestDb(): Promise<TestDb> {
  const connection = openDatabase('file::memory:')
  await ensureSchema(connection.client)
  const trips = new DrizzleTripRepository(connection.db)
  const { plan, details } = personaTrip()
  await trips.insertTrip({
    plan,
    details,
    ownerTokenHash: hasher.sha256Hex(OWNER_TOKEN),
    createdAtMs: NOW,
  })
  return {
    connection,
    trips,
    decks: new DrizzleStopDeckRepository(connection.db),
    events: new DrizzleTripEventRepository(connection.db),
  }
}

const L = (ja: string, en: string, zh: string, ko: string) => ({ ja, en, zh, ko })

/** 検証を通る文（材料の場面と選択肢の id・数・順のまま） */
export function validStopWriting(brief: Pick<StopWritingBrief, 'scenes'>): StopWriting {
  return {
    scenes: brief.scenes.map((scene) => ({
      id: scene.id,
      headline: L(
        '雪原に群れがいた',
        'A flock on the snowfield',
        '雪原上有鶴群',
        '설원에 무리가 있었다',
      ),
      body: L(
        '同乗者が双眼鏡を回した。',
        'Your friends passed the binoculars around.',
        '同伴們輪流用望遠鏡。',
        '동행이 쌍안경을 돌려 보았다.',
      ),
      choices: scene.choices.map((c) => ({
        id: c.id,
        label: L('いま出発する', 'Leave now', '現在出發', '지금 출발한다'),
        note: L(
          '暗くなる前に走る',
          'Drive before it gets dark',
          '天黑前上路',
          '어두워지기 전에 달린다',
        ),
      })),
    })),
  }
}

type Step =
  | 'valid'
  | SceneWriterOutcome
  | Error
  | ((request: SceneWriterRequest) => SceneWriterOutcome | Promise<SceneWriterOutcome>)

/** 決めた順に応える Claude のフェイク。手順が尽きたら valid を返す */
export class ScriptedSceneWriter implements SceneWriterGateway {
  readonly calls: SceneWriterRequest[] = []
  constructor(private readonly steps: Step[] = []) {}

  async write(request: SceneWriterRequest): Promise<SceneWriterOutcome> {
    this.calls.push(request)
    const step = this.steps.shift() ?? 'valid'
    if (step instanceof Error) throw step
    if (step === 'valid') return { kind: 'draft', writing: validStopWriting(request.brief) }
    if (typeof step === 'function') return step(request)
    return step
  }
}
