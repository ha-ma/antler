import { TripDetailsSchema, TripPlanSchema, type TripDetails, type TripPlan } from '@antler/schema'
import type { TripInput } from '@antler/trip'
import { useMutation } from '@tanstack/react-query'
import { logger } from '@/shared/utils/logger'
import type { CreateTripFailure } from '../types'

// 「この旅を守りに行く」→ POST /api/trips（R5・R8）。
// 押すごとに冪等キーを作り、入力と一緒に sessionStorage に残す。失敗後の「もう一度」は同じキーと入力で送り直す
// （api は同じキーの 2 回目に作り終えた旅を返す）。成功したら消す。
// ownerToken（A-7 の削除の権利）は作成時の 1 回しか受け取れないので、旅の id ごとに localStorage に残す（R7）。
// 削除の画面と API は record の feature。ログには出さない。

const PENDING_KEY = 'antler.plan-trip.pending'
const OWNER_KEY_PREFIX = 'antler.trip-owner.'

/** その旅の所有者トークン（この端末で作った旅だけ）。無ければ null。 */
export function ownerTokenOf(tripId: string): string | null {
  try {
    return typeof localStorage === 'undefined'
      ? null
      : localStorage.getItem(OWNER_KEY_PREFIX + tripId)
  } catch {
    return null
  }
}

function keepOwnerToken(tripId: string, token: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(OWNER_KEY_PREFIX + tripId, token)
  } catch (error) {
    // 残せなくても旅の作成は成功している（削除ができないだけ）
    logger.error('plan-trip.owner-storage', error)
  }
}

export type CreateTripAttempt = { key: string; input: TripInput }

export type CreatedTrip = { plan: TripPlan; details: TripDetails; ownerToken: string }

/** 作成の失敗。status は HTTP のステータス（通信の失敗は null）。 */
export class CreateTripError extends Error {
  readonly status: number | null

  constructor(status: number | null, message: string) {
    super(message)
    this.name = 'CreateTripError'
    this.status = status
  }

  /** 画面の文言の種類。429（IP あたり・全体の 1 日）は「本日の生成上限」。 */
  get failure(): CreateTripFailure {
    return this.status === 429 ? 'limit' : 'failed'
  }
}

function apiBase(): string {
  const base = import.meta.env.VITE_API_BASE_URL as string | undefined
  return (base ?? '').replace(/\/+$/, '')
}

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch (error) {
    // プライベートモードなどで使えないときは残さない（同じタブの mutation の変数で再送する）
    logger.error('plan-trip.session-storage', error)
    return null
  }
}

/** 押したときの新しい試み。キーを作り、入力と一緒に残す。 */
export function startAttempt(input: TripInput): CreateTripAttempt {
  const attempt = { key: crypto.randomUUID(), input }
  try {
    storage()?.setItem(PENDING_KEY, JSON.stringify(attempt))
  } catch (error) {
    // 容量超過など。残せなくても送信は続ける（同じタブの mutation の変数で再送する）
    logger.error('plan-trip.session-storage', error)
  }
  return attempt
}

/** 残っている試み（「もう一度」用）。無いか読めなければ null。 */
export function pendingAttempt(): CreateTripAttempt | null {
  const raw = storage()?.getItem(PENDING_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<CreateTripAttempt>
    return typeof parsed.key === 'string' && parsed.input ? (parsed as CreateTripAttempt) : null
  } catch (error) {
    logger.error('plan-trip.pending-parse', error)
    return null
  }
}

function clearAttempt(): void {
  storage()?.removeItem(PENDING_KEY)
}

async function postTrip({ key, input }: CreateTripAttempt): Promise<CreatedTrip> {
  let response: Response
  try {
    response = await fetch(`${apiBase()}/api/trips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(input),
    })
  } catch (error) {
    throw new CreateTripError(null, error instanceof Error ? error.message : 'network error')
  }
  if (!response.ok) {
    throw new CreateTripError(response.status, `POST /api/trips ${String(response.status)}`)
  }
  const body = (await response.json()) as Record<string, unknown>
  const plan = TripPlanSchema.safeParse(body['plan'])
  const details = TripDetailsSchema.safeParse(body['details'])
  const ownerToken = body['ownerToken']
  if (!plan.success || !details.success || typeof ownerToken !== 'string') {
    throw new CreateTripError(response.status, 'POST /api/trips の応答の形が違う')
  }
  // 型では表せない対応（TripDetails の約束）: 同じ旅で、タイトルは表示中の言語のもの、日ごとの説明は days と同じ数・順
  const { data: p } = plan
  const { data: d } = details
  const consistent =
    d.tripId === p.id &&
    d.titles[p.lang] === p.title &&
    d.dayNotes.length === p.days.length &&
    d.dayNotes.every((note, i) => note.day === p.days[i]?.day)
  if (!consistent) {
    throw new CreateTripError(
      response.status,
      'POST /api/trips の plan と details が対応していない',
    )
  }
  return { plan: plan.data, details: details.data, ownerToken }
}

/** 旅の作成（TanStack Query の mutation）。 */
export function useCreateTrip() {
  return useMutation<CreatedTrip, CreateTripError, CreateTripAttempt>({
    mutationFn: postTrip,
    onSuccess: ({ plan, ownerToken }) => {
      keepOwnerToken(plan.id, ownerToken)
      clearAttempt()
    },
    onError: (error) => {
      // 入力・キー・所有者トークンは記録しない
      logger.error('plan-trip.create', error, { status: error.status })
    },
  })
}
