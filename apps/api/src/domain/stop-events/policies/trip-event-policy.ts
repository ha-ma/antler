import type { StopDeck } from '../models/stop-deck.js'
import type {
  ResolvedChoice,
  TripEventData,
  TripEventInput,
  TripEventRecord,
} from '../models/trip-event.js'

// イベントの行の組み立てと、再送の判定（docs/specs/stop-events/functional.md R10、resilience.md）。

/** 保存した束から choice の値を引く。場面か選択肢が無ければ null */
export function resolveChoice(
  deck: Pick<StopDeck, 'scenes'>,
  sceneId: string,
  choiceId: string,
): ResolvedChoice | null {
  const scene = deck.scenes.find((s) => s.id === sceneId)
  const choice = scene?.choices.find((c) => c.id === choiceId)
  if (!scene || !choice) return null
  return {
    sceneId,
    choiceId,
    sceneKind: scene.kind,
    choiceKind: choice.kind,
    delayMin: choice.delayMin,
    endsDay: choice.endsDay,
    plannedLight: choice.zone?.light ?? null,
    lostJPY: choice.lost.jpy,
    lostWeight: choice.lost.weight,
    lostPleasures: [...choice.lost.pleasures],
    lateReturn: choice.lost.lateReturn,
  }
}

const DAY_MS = 24 * 60 * 60 * 1000
const JST_MS = 9 * 60 * 60 * 1000

/** 日本時間の暦日の通し番号 */
function jstDayIndex(ms: number): number {
  return Math.floor((ms + JST_MS) / DAY_MS)
}

/**
 * 欄どうしの整合（R10・LOG-3f）。問題が無ければ空配列。
 * - at の日本時間の暦日が、旅の day 日目か翌日（深夜の運転）
 * - alerted: false なら alertDistanceM は null。アラート OFF の run で alerted: true は無い
 * @param departAtMs 旅の出発の時刻（day 1 の暦日を決める）
 */
export function eventProblems(
  event: TripEventInput,
  ctx: { departAtMs: number; alertEnabled: boolean },
): string[] {
  const problems: string[] = []
  const expected = jstDayIndex(ctx.departAtMs) + event.day - 1
  const actual = jstDayIndex(Date.parse(event.at))
  if (actual !== expected && actual !== expected + 1)
    problems.push(`seq ${String(event.seq)}: at と day`)
  if (event.kind === 'encounter') {
    if (!event.alerted && event.alertDistanceM !== null) {
      problems.push(`seq ${String(event.seq)}: alertDistanceM`)
    }
    if (event.alerted && !ctx.alertEnabled) problems.push(`seq ${String(event.seq)}: alerted`)
  }
  if (event.kind === 'avoidance' && !ctx.alertEnabled && event.alertToBrakeMs !== null) {
    problems.push(`seq ${String(event.seq)}: alertToBrakeMs`)
  }
  return problems
}

/** 端末のイベントを行にする。choice は resolved（束の値）を写す */
export function toEventRecord(
  input: TripEventInput,
  run: { tripId: string; runId: string; alertEnabled: boolean; receivedAtMs: number },
  resolved: ResolvedChoice | null,
): TripEventRecord {
  const base = {
    tripId: run.tripId,
    runId: run.runId,
    seq: input.seq,
    day: input.day,
    kind: input.kind,
    at: input.at,
    alertEnabled: run.alertEnabled,
    leg: input.leg ?? null,
    km: input.km ?? null,
    receivedAtMs: run.receivedAtMs,
  }
  return { ...base, data: dataOf(input, resolved) }
}

function dataOf(input: TripEventInput, resolved: ResolvedChoice | null): TripEventData {
  switch (input.kind) {
    case 'choice':
      if (!resolved) throw new RangeError('choice は束の値で解決してから行にする')
      return resolved
    case 'encounter':
      return {
        pattern: input.pattern,
        alerted: input.alerted,
        alertDistanceM: input.alertDistanceM,
        userSpotted: input.userSpotted,
      }
    case 'collision':
      return { pattern: input.pattern, speedKmh: input.speedKmh }
    case 'avoidance':
      return {
        pattern: input.pattern,
        closestM: input.closestM,
        alertToBrakeMs: input.alertToBrakeMs,
      }
  }
}

/** 再送の比較に使う中身（受けた時刻を除く）。同じなら重複、違えば衝突 */
export function eventFingerprint(record: TripEventRecord): string {
  return canonical({ ...record, receivedAtMs: undefined })
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}
