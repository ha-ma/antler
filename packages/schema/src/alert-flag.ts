import { z } from 'zod'
import { IsoDateTime, Side } from './common'

// AlertFlag — B が WebSocket で送り、A がゲーム内で合成する共通メッセージ（ch7）。
// 「deer:true なら距離と方向が要る」「inside は残り距離、outside は次のゾーンまでの距離」を
// JSON Schema でも表せるよう、4 通りの組み合わせの union にする（refine を使わない）。

const base = {
  type: z.literal('flag'),
  v: z.literal(1),
  t_frame: IsoDateTime,
  t_sent: IsoDateTime,
  frameJpegB64: z.string().nullable().optional(),
}

const deerOn = {
  deer: z.literal(true),
  conf: z.number().min(0).max(1),
  distanceM: z.number().min(0),
  side: Side,
}

const deerOff = {
  deer: z.literal(false),
  conf: z.number().min(0).max(1).optional(),
}

const inside = {
  zone: z.literal('inside'),
  zoneRemainingKm: z.number().min(0),
}

const outside = {
  zone: z.literal('outside'),
  /** 次の鹿ゾーンまでの距離。ルートの先にゾーンが無ければ省く。 */
  zoneDistanceKm: z.number().min(0).optional(),
}

export const AlertFlagSchema = z.union([
  z.strictObject({ ...base, ...deerOn, ...inside }),
  z.strictObject({ ...base, ...deerOn, ...outside }),
  z.strictObject({ ...base, ...deerOff, ...inside }),
  z.strictObject({ ...base, ...deerOff, ...outside }),
])
export type AlertFlag = z.infer<typeof AlertFlagSchema>

/** 受信側が読み取れたもの。壊れた項目は入れない（R11: 受信は deer を最優先で読む）。 */
export type ReceivedFlag = {
  deer: boolean
  /** 厳しい検証（AlertFlagSchema）も通ったか */
  strict: boolean
  conf?: number
  distanceM?: number
  side?: Side
  zone?: 'inside' | 'outside'
  zoneRemainingKm?: number
  zoneDistanceKm?: number
}

/** 読み取れなかった・一部だけ読めた理由。受け取った中身は入れない（ログに本文を残さない）。 */
export type FlagProblem = 'invalid_json' | 'not_flag' | 'partial'

export type ReadFlagResult = { flag: ReceivedFlag | null; problem?: FlagProblem }

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/**
 * WebSocket で届いたもの（文字列か、JSON.parse 済みの値）をゆるく読む。
 * type が flag で deer が真偽値なら、ほかの項目が壊れていても deer は読む（見逃しを減らす。ch6）。
 * conf では間引かない。
 */
export function readAlertFlag(input: unknown): ReadFlagResult {
  let value: unknown = input
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input)
    } catch {
      return { flag: null, problem: 'invalid_json' }
    }
  }
  if (typeof value !== 'object' || value === null) {
    return { flag: null, problem: 'not_flag' }
  }
  const raw = value as Record<string, unknown>
  if (raw['type'] !== 'flag' || typeof raw['deer'] !== 'boolean') {
    return { flag: null, problem: 'not_flag' }
  }
  const strict = AlertFlagSchema.safeParse(raw).success
  const flag: ReceivedFlag = { deer: raw['deer'], strict }
  const conf = finiteNonNegative(raw['conf'])
  if (conf !== undefined && conf <= 1) flag.conf = conf
  const distanceM = finiteNonNegative(raw['distanceM'])
  if (distanceM !== undefined) flag.distanceM = distanceM
  const side = Side.safeParse(raw['side'])
  if (side.success) flag.side = side.data
  if (raw['zone'] === 'inside' || raw['zone'] === 'outside') flag.zone = raw['zone']
  const remaining = finiteNonNegative(raw['zoneRemainingKm'])
  if (remaining !== undefined) flag.zoneRemainingKm = remaining
  const toNext = finiteNonNegative(raw['zoneDistanceKm'])
  if (toNext !== undefined) flag.zoneDistanceKm = toNext
  return strict ? { flag } : { flag, problem: 'partial' }
}
