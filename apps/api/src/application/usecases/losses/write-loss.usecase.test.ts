import {
  InMemoryLossRepository,
  PERSONA_COLLISION,
  PERSONA_TRIP_ID,
  personaTrip,
  ScriptedLossWriter,
  validStory,
} from '../../../../tests/factories/losses.js'
import { FixedClock, InMemoryTripRepository, MemoryLog } from '../../../../tests/factories/trips.js'
import { LossLimitError, LossWriterError } from '../../../domain/losses/errors/loss-errors.js'
import { lossKeyMaterial } from '../../../domain/losses/policies/collision-policy.js'
import {
  DailyLimitError,
  TripInputError,
  TripNotFoundError,
  TripWriterBusyError,
} from '../../../domain/trips/errors/trip-errors.js'
import { NodeSha256Hasher } from '../../../infrastructure/security/node-crypto.js'
import { InProcessConcurrencyLimiter } from '../../../infrastructure/system/in-process-concurrency-limiter.js'
import { WriteLossUseCase } from './write-loss.usecase.js'

// docs/specs/loss/functional.md R5〜R8、resilience.md（UC-5c・UC-5f・UC-5g・UC-6a・UC-6b・FAIL-*・IDEM-*・CONC-1）

const T0 = Date.parse('2026-11-04T12:00:00+09:00')
const hasher = new NodeSha256Hasher()

function setup(
  opts: {
    writer?: ScriptedLossWriter
    dailyCalls?: number
    slots?: InProcessConcurrencyLimiter
  } = {},
) {
  const trips = new InMemoryTripRepository()
  trips.trips.set(PERSONA_TRIP_ID, personaTrip())
  const losses = new InMemoryLossRepository()
  const writer = opts.writer ?? new ScriptedLossWriter()
  const log = new MemoryLog()
  const usecase = new WriteLossUseCase({
    trips,
    losses,
    writer,
    writerSlots: opts.slots ?? new InProcessConcurrencyLimiter(4),
    hasher,
    clock: new FixedClock(T0),
    log,
    dailyWriterCallLimit: opts.dailyCalls ?? 400,
  })
  const run = (collision = PERSONA_COLLISION, tripId = PERSONA_TRIP_ID) =>
    usecase.execute({ tripId, collision })
  return { trips, losses, writer, log, run }
}

const koEmpty = () => {
  const s = validStory()
  s.story.ko = ''
  return { kind: 'draft' as const, output: s }
}

describe('WriteLossUseCase', () => {
  it('UC-5c: 正常 → 4 言語の文を保存して返す（replayed: false）', async () => {
    const { run, losses, writer } = setup()
    const out = await run()
    expect(out.replayed).toBe(false)
    expect(out.loss.tripId).toBe(PERSONA_TRIP_ID)
    expect(out.loss.story).toEqual(validStory().story)
    expect(out.loss.createdAt).toBe(new Date(T0).toISOString())
    expect(losses.losses.size).toBe(1)
    expect(writer.calls).toHaveLength(1)
    expect(writer.calls[0]?.brief.achieved.map((n) => n.ja)).toEqual(['タンチョウ'])
  })

  it('UC-5c / FAIL-2: 1 回目が外れたら作り直し、2 回目が通れば保存。2 回とも外れたら LossWriterError で保存しない', async () => {
    const once = setup({ writer: new ScriptedLossWriter([koEmpty]) })
    const out = await once.run()
    expect(out.loss.story.ko).not.toBe('')
    expect(once.writer.calls).toHaveLength(2)
    expect(once.writer.calls[1]?.previousProblems).toEqual(['empty@story.ko'])

    const twice = setup({ writer: new ScriptedLossWriter([koEmpty, koEmpty]) })
    await expect(twice.run()).rejects.toBeInstanceOf(LossWriterError)
    expect(twice.losses.losses.size).toBe(0)
  })

  it('FAIL-3: 上限で切れた・断られた・形の違う応答は外れとして作り直す', async () => {
    const { run, writer } = setup({
      writer: new ScriptedLossWriter([
        { kind: 'rejected', reason: 'truncated' },
        { kind: 'rejected', reason: 'refused' },
      ]),
    })
    const error = await run().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LossWriterError)
    expect((error as LossWriterError).reason).toBe('refused')
    expect(writer.calls).toHaveLength(2)
  })

  it('FAIL-1: Claude の時間切れ → LossWriterError、保存しない。もう一度送ると呼び直して作る', async () => {
    const { run, losses, writer } = setup({
      writer: new ScriptedLossWriter([new LossWriterError('timeout')]),
    })
    await expect(run()).rejects.toBeInstanceOf(LossWriterError)
    expect(losses.losses.size).toBe(0)
    const out = await run()
    expect(out.replayed).toBe(false)
    expect(writer.calls).toHaveLength(2)
  })

  it('IDEM-1 / AUTH-6: 同じ記述子の 2 回目は保存した文を返し、Claude を呼ばない', async () => {
    const { run, writer } = setup()
    const first = await run()
    const second = await run({ ...PERSONA_COLLISION, at: '2027-02-15T07:31:05Z' })
    expect(second.replayed).toBe(true)
    expect(second.loss).toEqual(first.loss)
    expect(writer.calls).toHaveLength(1)
  })

  it('IDEM-2: leg・alertEnabled が違えば別の鍵で新しく作る', async () => {
    const { run, writer, losses } = setup()
    await run()
    await run({ ...PERSONA_COLLISION, alertEnabled: true })
    await run({ ...PERSONA_COLLISION, achievedStops: [] })
    expect(writer.calls).toHaveLength(3)
    expect(losses.losses.size).toBe(3)
  })

  it('FAIL-5: 保存済みの文を返すときは 1 日の上限を数えない', async () => {
    const { run, trips } = setup()
    await run()
    await run()
    await run()
    expect([...trips.writerCalls.values()]).toEqual([1])
  })

  it('AUTH-4: 1 日の上限（plan-trip と共有の数え上げ）に達したら Claude を呼ばずに DailyLimitError', async () => {
    const { run, writer } = setup({ dailyCalls: 0 })
    await expect(run()).rejects.toBeInstanceOf(DailyLimitError)
    expect(writer.calls).toHaveLength(0)
  })

  it('FAIL-4: 同時の枠が埋まっていれば Claude を呼ばずに TripWriterBusyError', async () => {
    const slots = new InProcessConcurrencyLimiter(1)
    const hold = slots.tryAcquire()
    const { run, writer } = setup({ slots })
    await expect(run()).rejects.toBeInstanceOf(TripWriterBusyError)
    expect(writer.calls).toHaveLength(0)
    hold?.()
  })

  it('UC-5f: 同じ鍵の同時の 2 要求 → Claude は 1 回、両方に同じ文', async () => {
    let open: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    const { run, writer } = setup({ writer: new ScriptedLossWriter([], gate) })
    const a = run()
    const b = run({ ...PERSONA_COLLISION, at: '2027-02-15T16:31:30+09:00' })
    open()
    const [ra, rb] = await Promise.all([a, b])
    expect(writer.calls).toHaveLength(1)
    expect(rb.loss).toEqual(ra.loss)
  })

  it('CONC-1: 保存の INSERT が負けた（別のプロセスが先に保存）→ 保存済みの文を返す', async () => {
    const { run, losses } = setup()
    const winner = {
      keyHash: hasher.sha256Hex(lossKeyMaterial(PERSONA_TRIP_ID, PERSONA_COLLISION)),
      tripId: PERSONA_TRIP_ID,
      collision: PERSONA_COLLISION,
      story: { ja: '先に保存した文', en: 'Saved first', zh: '先保存的文', ko: '먼저 저장한 글' },
      createdAtMs: T0 - 1000,
    }
    losses.raceWith = winner
    const out = await run()
    expect(out.replayed).toBe(true)
    expect(out.loss.story).toEqual(winner.story)
  })

  it('UC-5g: 1 つの旅に 20 件保存したあと、新しい鍵は Claude を呼ばずに LossLimitError。保存済みの鍵は返せる', async () => {
    const { run, losses, writer } = setup()
    await run()
    for (let i = 0; i < 19; i++) {
      losses.losses.set(`other-${String(i)}`, {
        keyHash: `other-${String(i)}`,
        tripId: PERSONA_TRIP_ID,
        collision: PERSONA_COLLISION,
        story: validStory().story,
        createdAtMs: T0,
      })
    }
    await expect(run({ ...PERSONA_COLLISION, alertEnabled: true })).rejects.toBeInstanceOf(
      LossLimitError,
    )
    expect(writer.calls).toHaveLength(1)
    expect((await run()).replayed).toBe(true)
  })

  it('UC-6a / AUTH-2: 無い旅・形の違う id は TripNotFoundError、Claude を呼ばない', async () => {
    const { run, writer } = setup()
    await expect(run(PERSONA_COLLISION, 'Nope1234')).rejects.toBeInstanceOf(TripNotFoundError)
    await expect(run(PERSONA_COLLISION, '../x')).rejects.toBeInstanceOf(TripNotFoundError)
    expect(writer.calls).toHaveLength(0)
  })

  it('UC-6b: しおりと合わない記述子は TripInputError、Claude を呼ばない', async () => {
    const { run, writer } = setup()
    const bad = [
      { ...PERSONA_COLLISION, day: 6 },
      { ...PERSONA_COLLISION, leg: 1 },
      { ...PERSONA_COLLISION, day: 3, achievedStops: [] },
      { ...PERSONA_COLLISION, at: '2027-02-16T09:00:00+09:00' },
      { ...PERSONA_COLLISION, at: '2027-02-15T16:31:00' },
      { ...PERSONA_COLLISION, achievedStops: ['drift-ice-walk'] },
    ]
    for (const collision of bad) await expect(run(collision)).rejects.toBeInstanceOf(TripInputError)
    expect(writer.calls).toHaveLength(0)
  })

  it('UC-5a: ログに Claude の本文・材料を出さない', async () => {
    const { run, log } = setup()
    await run()
    const text = JSON.stringify(log.events)
    expect(text).not.toContain('タンチョウ')
    expect(text).not.toContain('鶴居')
    expect(log.has('loss.created')).toBe(true)
  })
})
