import { TripDetailsSchema, TripPlanSchema } from '@antler/schema'
import { assessRisk, buildItinerary, PERSONA_INPUT, type TripInput } from '@antler/trip'
import {
  FixedClock,
  InMemoryTripRepository,
  InMemoryUnitOfWork,
  KEY_A,
  MemoryLog,
  ScriptedRandom,
  ScriptedWriter,
  validWriting,
} from '../../../../tests/factories/trips.js'
import {
  DailyLimitError,
  IdempotencyMismatchError,
  TripInProgressError,
  TripWriterError,
} from '../../../domain/trips/errors/trip-errors.js'
import {
  canonicalJson,
  idempotencyKeyMaterial,
  ownerTokenMaterial,
} from '../../../domain/trips/policies/trip-identity-policy.js'
import { PENDING_STALE_MS } from '../../../domain/trips/rules/trip-rules.js'
import {
  HmacSha256TokenSigner,
  NodeSha256Hasher,
} from '../../../infrastructure/security/node-crypto.js'
import { CreateTripUseCase } from './create-trip.usecase.js'

const T0 = Date.parse('2026-11-03T12:00:00+09:00')
const hasher = new NodeSha256Hasher()
const SECRET = 'test-owner-token-secret-0123456789abcdef'
const ownerTokens = new HmacSha256TokenSigner(SECRET)
const keyHash = (key: string) => hasher.sha256Hex(idempotencyKeyMaterial(key))

function setup(
  opts: {
    writer?: ScriptedWriter
    random?: ScriptedRandom
    dailyLimit?: number
    secret?: string
  } = {},
) {
  const repo = new InMemoryTripRepository()
  const writer = opts.writer ?? new ScriptedWriter()
  const clock = new FixedClock(T0)
  const log = new MemoryLog()
  const usecase = new CreateTripUseCase({
    trips: repo,
    uow: new InMemoryUnitOfWork(repo),
    writer,
    random: opts.random ?? new ScriptedRandom(),
    hasher,
    ownerTokens: new HmacSha256TokenSigner(opts.secret ?? SECRET),
    clock,
    log,
    dailyLimit: opts.dailyLimit ?? 200,
  })
  const run = (trip: TripInput = PERSONA_INPUT, idempotencyKey = KEY_A) =>
    usecase.execute({ idempotencyKey, trip })
  return { repo, writer, clock, log, usecase, run }
}

describe('CreateTripUseCase', () => {
  it('UC-5a: 正常 → titles 4 言語、dayNotes の数 = days の数、plan.title = titles[lang]', async () => {
    const { run, repo } = setup()
    const out = await run()
    expect(TripPlanSchema.parse(out.plan)).toBeTruthy()
    expect(TripDetailsSchema.parse(out.details)).toBeTruthy()
    expect(out.details.dayNotes).toHaveLength(out.plan.days.length)
    expect(out.plan.title).toBe(out.details.titles[PERSONA_INPUT.lang])
    expect(out.plan.alertEnabled).toBe(true)
    expect(out.replayed).toBe(false)
    expect(repo.requests.get(keyHash(KEY_A))).toMatchObject({ status: 'done', tripId: out.plan.id })
  })

  it('R3・R4: days と riskScore は api が @antler/trip で計算し直した値', async () => {
    const { run } = setup()
    const out = await run()
    const itinerary = buildItinerary(PERSONA_INPUT)
    expect(out.plan.days).toEqual(itinerary.days)
    expect(out.plan.riskScore).toBe(assessRisk(PERSONA_INPUT, itinerary).score)
    expect(out.details.skipped).toEqual(itinerary.skipped)
  })

  it('UC-5d: Claude に渡すのは選択肢由来の値だけ（統計の根拠文を渡さない）', async () => {
    const { run, writer } = setup()
    await run()
    const brief = writer.calls[0]?.brief
    if (!brief) throw new Error('Claude が呼ばれていない')
    expect(Object.keys(brief).sort()).toEqual(
      [
        'area',
        'budgetPerPersonJPY',
        'days',
        'depart',
        'lang',
        'party',
        'return',
        'riskLevel',
        'skipped',
      ].sort(),
    )
    expect(brief.days).toHaveLength(5)
    expect(brief.depart.date).toEqual({ month: 2, dayOfMonth: 14 })
    expect(brief.days[4]?.date).toEqual({ month: 2, dayOfMonth: 18 })
    expect(JSON.stringify(brief)).not.toMatch(/reasons|contributions|riskScore/)
  })

  it('UC-7a・UC-7c: id は英数 8 文字・seed は範囲内。ownerToken は HMAC でレスポンスにだけあり、保存はハッシュ', async () => {
    const { run, repo } = setup()
    const out = await run()
    expect(out.plan.id).toMatch(/^[A-Za-z0-9]{8}$/)
    expect(out.plan.seed).toBeGreaterThanOrEqual(0)
    expect(out.plan.seed).toBeLessThanOrEqual(0xffff_ffff)
    expect(out.ownerToken).toBe(ownerTokens.sign(ownerTokenMaterial(KEY_A)))
    expect(out.ownerToken).toMatch(/^[0-9a-f]{64}$/)
    // 秘密なしの単純なハッシュではない（キーだけからは計算できない）
    expect(out.ownerToken).not.toBe(hasher.sha256Hex(ownerTokenMaterial(KEY_A)))
    const stored = repo.trips.get(out.plan.id)
    expect(stored?.ownerTokenHash).toBe(hasher.sha256Hex(out.ownerToken))
    expect(JSON.stringify(stored)).not.toContain(out.ownerToken)
    expect(JSON.stringify([...repo.requests.values()])).not.toContain(KEY_A)
    expect(JSON.stringify([...repo.requests.values()])).not.toContain(out.ownerToken)
  })

  it('UC-7c: 秘密（OWNER_TOKEN_SECRET）が違えば、同じキーでも別のトークンになる', async () => {
    const a = await setup().run()
    const b = await setup({ secret: 'another-owner-token-secret-abcdefghijklmn' }).run()
    expect(a.ownerToken).not.toBe(b.ownerToken)
  })

  it('UC-7b・CONC-2: id が衝突したら別の id で作り直して保存する', async () => {
    // 1 回目と 2 回目は同じ id（AAAAAAAA）、3 回目は BBBBBBBB
    const random = new ScriptedRandom([0, 0, 0, 0, 1, 1])
    const { run, repo, log } = setup({ random })
    const first = await run(PERSONA_INPUT, KEY_A)
    expect(first.plan.id).toBe('AAAAAAAA')
    const second = await run(PERSONA_INPUT, '11111111-2222-4333-8444-555555555555')
    expect(second.plan.id).toBe('BBBBBBBB')
    expect(repo.trips.size).toBe(2)
    expect(log.has('trip.id.collision')).toBe(true)
  })

  it('UC-7b: 衝突が続けば 4 回であきらめて失敗（failed）', async () => {
    const random = new ScriptedRandom(Array.from({ length: 20 }, () => 0))
    const { run, repo } = setup({ random })
    await run(PERSONA_INPUT, KEY_A)
    const other = '11111111-2222-4333-8444-555555555555'
    await expect(run(PERSONA_INPUT, other)).rejects.toThrow(/衝突/)
    expect(repo.requests.get(keyHash(other))?.status).toBe('failed')
  })

  it('IDEM-1: 同じキー・同じ body で 2 回 → 2 回目は同じ旅を返し、Claude は 1 回だけ', async () => {
    const { run, writer, repo } = setup()
    const first = await run()
    const second = await run()
    expect(second.replayed).toBe(true)
    expect(second.plan).toEqual(first.plan)
    expect(second.details).toEqual(first.details)
    // 再送でも同じ所有者トークン（同じ秘密・同じキーの HMAC）
    expect(second.ownerToken).toBe(first.ownerToken)
    expect(second.ownerToken).toBe(ownerTokens.sign(ownerTokenMaterial(KEY_A)))
    expect(writer.calls).toHaveLength(1)
    expect(repo.trips.size).toBe(1)
  })

  it('IDEM-1: キーの順が違う同じ内容の body も同じ要求とみなす', async () => {
    const { run } = setup()
    await run()
    const { lang, ...rest } = PERSONA_INPUT
    const reordered: TripInput = { ...rest, lang }
    expect(Object.keys(reordered)[0]).not.toBe(Object.keys(PERSONA_INPUT)[0])
    expect((await run(reordered)).replayed).toBe(true)
  })

  it('AUTH-4: 同じキーで body を変えて送る → IdempotencyMismatchError、最初の旅を返さない', async () => {
    const { run, writer } = setup()
    await run()
    await expect(run({ ...PERSONA_INPUT, budgetPerPersonJPY: 0 })).rejects.toThrow(
      IdempotencyMismatchError,
    )
    expect(writer.calls).toHaveLength(1)
  })

  it('CONC-1: 同じキーの要求が処理中（pending、2 分以内）→ TripInProgressError、Claude を呼ばない', async () => {
    const { run, writer, repo, clock } = setup()
    await repo.insertPendingRequest({
      keyHash: keyHash(KEY_A),
      bodyHash: hasher.sha256Hex(canonicalJson(PERSONA_INPUT)),
      nowMs: T0,
    })
    clock.t = T0 + PENDING_STALE_MS - 1
    await expect(run()).rejects.toThrow(TripInProgressError)
    expect(writer.calls).toHaveLength(0)
  })

  it('CONC-1: 2 つの要求が同時に来ても、Claude は 1 回・旅は 1 つ', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => {
      release = r
    })
    const writer = new ScriptedWriter()
    const slow = {
      calls: writer.calls,
      write: async (req: Parameters<ScriptedWriter['write']>[0]) => {
        await gate
        return writer.write(req)
      },
    }
    const repo = new InMemoryTripRepository()
    const usecase = new CreateTripUseCase({
      trips: repo,
      uow: new InMemoryUnitOfWork(repo),
      writer: slow,
      random: new ScriptedRandom(),
      hasher,
      ownerTokens,
      clock: new FixedClock(T0),
      log: new MemoryLog(),
      dailyLimit: 200,
    })
    const first = usecase.execute({ idempotencyKey: KEY_A, trip: PERSONA_INPUT })
    await expect(usecase.execute({ idempotencyKey: KEY_A, trip: PERSONA_INPUT })).rejects.toThrow(
      TripInProgressError,
    )
    release()
    await first
    expect(writer.calls).toHaveLength(1)
    expect(repo.trips.size).toBe(1)
  })

  it('IDEM-2: 1 回目が失敗（failed）→ 同じキーで再送すると作り直して成功', async () => {
    const writer = new ScriptedWriter([new TripWriterError('timeout')])
    const { run, repo } = setup({ writer })
    await expect(run()).rejects.toThrow(TripWriterError)
    expect(repo.requests.get(keyHash(KEY_A))?.status).toBe('failed')
    const out = await run()
    expect(out.replayed).toBe(false)
    expect(repo.trips.size).toBe(1)
  })

  it('IDEM-3: pending が 2 分を過ぎた → 同じキーで作り直せる', async () => {
    const { run, repo, clock } = setup()
    await repo.insertPendingRequest({
      keyHash: keyHash(KEY_A),
      bodyHash: hasher.sha256Hex(canonicalJson(PERSONA_INPUT)),
      nowMs: T0,
    })
    clock.t = T0 + PENDING_STALE_MS
    const out = await run()
    expect(repo.requests.get(keyHash(KEY_A))).toMatchObject({ status: 'done', tripId: out.plan.id })
  })

  it('FAIL-1: Claude が時間切れ → TripWriterError、旅も詳細も保存しない、冪等キーは failed', async () => {
    const writer = new ScriptedWriter([new TripWriterError('timeout')])
    const { run, repo } = setup({ writer })
    await expect(run()).rejects.toMatchObject({ reason: 'timeout' })
    expect(repo.trips.size).toBe(0)
    expect(repo.requests.get(keyHash(KEY_A))?.status).toBe('failed')
    expect(writer.calls).toHaveLength(1)
  })

  it('UC-5b・FAIL-2: 1 言語だけ空 → 作り直し。2 回とも外れたら TripWriterError、保存しない', async () => {
    const koEmpty = (req: Parameters<ScriptedWriter['write']>[0]) => {
      const w = validWriting(req.brief)
      w.titles.ko = ''
      return { kind: 'draft' as const, writing: w }
    }
    const writer = new ScriptedWriter([koEmpty, koEmpty])
    const { run, repo, log } = setup({ writer })
    await expect(run()).rejects.toMatchObject({ reason: 'invalid' })
    expect(writer.calls).toHaveLength(2)
    expect(writer.calls[1]?.previousProblems).toEqual(['empty@titles.ko'])
    expect(repo.trips.size).toBe(0)
    expect(log.events.filter((e) => e.event === 'trip.writer.invalid')).toHaveLength(2)
  })

  it('FAIL-2: 1 回目だけ外れたら 2 回目の結果で成功', async () => {
    const statsLike = (req: Parameters<ScriptedWriter['write']>[0]) => {
      const w = validWriting(req.brief)
      w.titles.ja = '鹿の事故は 123 件'
      return { kind: 'draft' as const, writing: w }
    }
    const writer = new ScriptedWriter([statsLike])
    const { run } = setup({ writer })
    const out = await run()
    expect(out.details.titles.ja).toBe(validWriting({ days: [] }).titles.ja)
    expect(writer.calls[1]?.previousProblems).toEqual([
      'number@titles.ja',
      'forbidden-symbol@titles.ja',
    ])
  })

  it('UC-5: 説明が 1 日ぶん足りない → 外れ扱い', async () => {
    const short = (req: Parameters<ScriptedWriter['write']>[0]) => ({
      kind: 'draft' as const,
      writing: validWriting({ days: req.brief.days.slice(1) }),
    })
    const writer = new ScriptedWriter([short, short])
    const { run } = setup({ writer })
    await expect(run()).rejects.toThrow(TripWriterError)
  })

  it('FAIL-3: max_tokens で切れた応答（rejected: truncated）→ 外れ扱い。2 回とも切れたら失敗', async () => {
    const truncated = { kind: 'rejected' as const, reason: 'truncated' as const }
    const writer = new ScriptedWriter([truncated, truncated])
    const { run, repo } = setup({ writer })
    await expect(run()).rejects.toMatchObject({ reason: 'truncated' })
    expect(writer.calls[1]?.previousProblems).toEqual(['truncated'])
    expect(repo.trips.size).toBe(0)
  })

  it('FAIL-4: 保存のトランザクションが失敗 → 例外（500）、旅の行が残らない、冪等キーは failed', async () => {
    const { run, repo, log } = setup()
    repo.failInsertTrip = new Error('SQLITE_IOERR')
    await expect(run()).rejects.toThrow('SQLITE_IOERR')
    expect(repo.trips.size).toBe(0)
    expect(repo.requests.get(keyHash(KEY_A))?.status).toBe('failed')
    expect(log.has('trip.save.failed')).toBe(true)
  })

  it('AUTH-2・FAIL-5: 1 日の上限に達したら Claude を呼ばずに DailyLimitError、キーは failed', async () => {
    const { run, writer, repo, log } = setup({ dailyLimit: 1 })
    await run(PERSONA_INPUT, KEY_A)
    const other = '11111111-2222-4333-8444-555555555555'
    await expect(run(PERSONA_INPUT, other)).rejects.toThrow(DailyLimitError)
    expect(writer.calls).toHaveLength(1)
    expect(repo.requests.get(keyHash(other))?.status).toBe('failed')
    expect(log.has('trip.daily_limit')).toBe(true)
  })

  it('1 日の上限に達していても、作り終えた旅の再送は返す', async () => {
    const { run } = setup({ dailyLimit: 1 })
    await run()
    expect((await run()).replayed).toBe(true)
  })

  it('1 日の上限は日本時間の暦日で数える（翌日は作れる）', async () => {
    const { run, clock } = setup({ dailyLimit: 1 })
    await run(PERSONA_INPUT, KEY_A)
    clock.t = Date.parse('2026-11-04T00:00:00+09:00')
    const out = await run(PERSONA_INPUT, '11111111-2222-4333-8444-555555555555')
    expect(out.replayed).toBe(false)
  })
})
