import { IsoDateTime, Slug, type TripPlan } from '@antler/schema'
import { z } from 'zod'
import { DeerPatternSchema, type DriveRunInput } from './run'

// 旅の記録の集計（docs/specs/record/functional.md R3・R4）。api が保存した run から作り、
// `GET /api/trips/:id/record`・SSR・OG 画像に使う。sim はこの形で確かめてから描く。
// 日ごとに「鹿アラート ON の、保存順で最後の run」をその日の結果にする（ON が無い日は OFF の最後）。
// A7-4 の OFF の挑戦が、ON で守った日を上書きしないため。OFF の挑戦は offResult に別に出す。

/** 最接近がこれ以下の回避は「間一髪」（推奨で決定） */
export const CLOSE_CALL_M = 5

const DayNumber = z.number().int().min(1)

export const DayResultSchema = z.enum(['completed', 'collided', 'not-driven'])
export type DayResult = z.infer<typeof DayResultSchema>

export const TripRecordSchema = z.strictObject({
  /** 全日 completed → completed、run が無い → not-started、それ以外 → partial */
  status: z.enum(['completed', 'partial', 'not-started']),
  /** 保存順で最後の run の日（run が無ければ 1）。「アラート OFF で挑戦」の行き先 */
  lastDay: DayNumber,
  /** 走った日の最大（無ければ 0）。見出しの「D{n} まで走った」 */
  furthestDay: z.number().int().min(0),
  days: z.array(
    z.strictObject({
      day: DayNumber,
      result: DayResultSchema,
      /** その日の結果にした run の鹿アラート。走っていなければ null */
      alertEnabled: z.boolean().nullable(),
      /** その日の OFF の最新の run の結果（A7-4 の挑戦）。無ければ null */
      offResult: z.enum(['completed', 'collided']).nullable(),
    }),
  ),
  /** しおりの楽しみ（days の stops の順）。protected はその日が completed */
  pleasures: z.array(z.strictObject({ id: Slug, day: DayNumber, protected: z.boolean() })),
  totals: z.strictObject({
    pleasuresProtected: z.number().int().min(0),
    pleasuresTotal: z.number().int().min(0),
    zonePasses: z.number().int().min(0),
    encounters: z.number().int().min(0),
    avoided: z.number().int().min(0),
    collided: z.number().int().min(0),
    /** アラート→ブレーキの平均（ms、整数）。測れた遭遇が無ければ null */
    alertToBrakeAvgMs: z.number().int().min(0).nullable(),
  }),
  /** ゾーンでの各回（日 → 時刻の順。時刻の無いものはその日の後ろ） */
  log: z.array(
    z.strictObject({
      day: DayNumber,
      at: IsoDateTime.nullable(),
      pattern: DeerPatternSchema,
      closestM: z.number().min(0),
      alertToBrakeMs: z.number().min(0).nullable(),
      outcome: z.enum(['avoided', 'collided']),
      /** 最接近 CLOSE_CALL_M 以下の回避 */
      closeCall: z.boolean(),
      alertEnabled: z.boolean(),
    }),
  ),
})
export type TripRecord = z.infer<typeof TripRecordSchema>

/** 集計に要る旅の部分 */
export type RecordPlan = { days: readonly Pick<TripPlan['days'][number], 'day' | 'stops'>[] }

/** 集計に要る run の部分（保存順に並べて渡す） */
export type RecordRun = Pick<
  DriveRunInput,
  'day' | 'alertEnabled' | 'outcome' | 'zonePasses' | 'encounters'
>

export function summarizeRecord(plan: RecordPlan, runs: readonly RecordRun[]): TripRecord {
  const dayNumbers = new Set(plan.days.map((d) => d.day))
  const valid = runs.filter((r) => dayNumbers.has(r.day))
  const latestOn = new Map<number, RecordRun>()
  const latestOff = new Map<number, RecordRun>()
  for (const run of valid) (run.alertEnabled ? latestOn : latestOff).set(run.day, run)
  const latest = new Map<number, RecordRun>()
  for (const d of plan.days) {
    const run = latestOn.get(d.day) ?? latestOff.get(d.day)
    if (run) latest.set(d.day, run)
  }

  const days = plan.days.map((d) => {
    const run = latest.get(d.day)
    return {
      day: d.day,
      result: run ? run.outcome : ('not-driven' as const),
      alertEnabled: run ? run.alertEnabled : null,
      offResult: latestOff.get(d.day)?.outcome ?? null,
    }
  })
  const completed = new Set(days.filter((d) => d.result === 'completed').map((d) => d.day))
  const seen = new Set<string>()
  const pleasures = plan.days.flatMap((d) =>
    d.stops.flatMap((id) => {
      if (seen.has(id)) return []
      seen.add(id)
      return [{ id, day: d.day, protected: completed.has(d.day) }]
    }),
  )

  const latestRuns = plan.days.flatMap((d) => {
    const run = latest.get(d.day)
    return run ? [run] : []
  })
  const log = latestRuns
    .flatMap((run) =>
      run.encounters.map((e) => ({
        day: run.day,
        at: e.at,
        pattern: e.pattern,
        closestM: e.closestM,
        alertToBrakeMs: e.alertToBrakeMs,
        outcome: e.outcome,
        closeCall: e.outcome === 'avoided' && e.closestM <= CLOSE_CALL_M,
        alertEnabled: run.alertEnabled,
      })),
    )
    .sort(byDayThenTime)
  const measured = log.flatMap((l) => (l.alertToBrakeMs === null ? [] : [l.alertToBrakeMs]))

  return {
    status:
      latestRuns.length === 0
        ? 'not-started'
        : days.every((d) => d.result === 'completed')
          ? 'completed'
          : 'partial',
    lastDay: valid.at(-1)?.day ?? 1,
    furthestDay: Math.max(0, ...latestRuns.map((r) => r.day)),
    days,
    pleasures,
    totals: {
      pleasuresProtected: pleasures.filter((p) => p.protected).length,
      pleasuresTotal: pleasures.length,
      zonePasses: latestRuns.reduce((sum, r) => sum + r.zonePasses, 0),
      encounters: log.length,
      avoided: log.filter((l) => l.outcome === 'avoided').length,
      collided: log.filter((l) => l.outcome === 'collided').length,
      alertToBrakeAvgMs:
        measured.length === 0
          ? null
          : Math.round(measured.reduce((a, b) => a + b, 0) / measured.length),
    },
    log,
  }
}

function byDayThenTime(
  a: { day: number; at: string | null },
  b: { day: number; at: string | null },
): number {
  if (a.day !== b.day) return a.day - b.day
  if (a.at === b.at) return 0
  if (a.at === null) return 1
  if (b.at === null) return -1
  return Date.parse(a.at) - Date.parse(b.at)
}
