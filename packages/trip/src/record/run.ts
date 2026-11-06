import { IsoDateTime } from '@antler/schema'
import { z } from 'zod'

// 走行の記録（run）= 1 日の運転 1 回の要約（docs/specs/record/functional.md R2）。
// sim（drive・loss）が作って `POST /api/trips/:id/runs` に送り、api がこの形で確かめて保存する。
// A-6・A-7 の鹿アラートの ON / OFF は TripPlan ではなくここに持つ（plan-trip R10）。
// 位置（緯度経度）・端末の識別子は持たない（回数・時間・距離だけ）。

/** 1 つの旅の 1 日に残せる run の数（旅全体にすると、やり直しを重ねた日のせいでほかの日が残せなくなる） */
export const MAX_RUNS_PER_DAY = 20
/** 1 回の run に入れられる遭遇の数 */
export const MAX_ENCOUNTERS_PER_RUN = 50
/** 1 回の run で入れる鹿ゾーンの区間の数の上限 */
export const MAX_ZONE_PASSES = 50

/** 鹿の出方（A5-2。drive の DeerPattern と同じ語） */
export const DeerPatternSchema = z.enum(['roadside', 'eyeshine', 'crossing', 'herd', 'frozen'])
export type DeerPattern = z.infer<typeof DeerPatternSchema>

export const DriveEncounterSchema = z.strictObject({
  pattern: DeerPatternSchema,
  /** 赤が出たゲーム内の時刻（ISO、タイムゾーン付き）。赤が出ていなければ null */
  at: IsoDateTime.nullable(),
  /** アラート→ブレーキ（ms、A5-7）。アラート OFF・ブレーキなしは null */
  alertToBrakeMs: z.number().min(0).max(60_000).nullable(),
  /** 最接近距離（m、A5-7） */
  closestM: z.number().min(0).max(500),
  outcome: z.enum(['avoided', 'collided']),
})
export type DriveEncounter = z.infer<typeof DriveEncounterSchema>

export const FrameSummarySchema = z.strictObject({
  fpsMedian: z.number().min(0).max(1000),
  fpsP5: z.number().min(0).max(1000),
  frames: z.number().int().min(0),
  /**
   * 落ちたフレーム（40 ms を超えた rAF の間隔）の数と、数えたフレームの数（performance R1）。どちらも走行の全体
   * （frames は中央値・5 パーセンタイルの窓の数）。足す前に保存した run には無いので省略を許す
   */
  dropped: z.number().int().min(0).optional(),
  counted: z.number().int().min(0).optional(),
})

export const DriveRunInputSchema = z.strictObject({
  /** 端末が作る UUID（crypto.randomUUID）。同じ runId の再送は 1 件として扱う */
  runId: z.uuid(),
  day: z.number().int().min(1).max(999),
  alertEnabled: z.boolean(),
  outcome: z.enum(['completed', 'collided']),
  /** その走行で入った鹿ゾーンの区間の数 */
  zonePasses: z.number().int().min(0).max(MAX_ZONE_PASSES),
  encounters: z.array(DriveEncounterSchema).max(MAX_ENCOUNTERS_PER_RUN),
  /** 描画のフレーム時間の要約（ch6「requestAnimationFrame 計測を A-7 に記録」）。無ければ null */
  frames: FrameSummarySchema.nullable(),
})
export type DriveRunInput = z.infer<typeof DriveRunInputSchema>
