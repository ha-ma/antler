import { z } from 'zod'
import { AlertLevel } from './common'

// L1 判断（Mac mini 上の jev 互換サーバー）の結果を残す 2 つの部品。どちらも任意フィールドとして
// AlertFlag.l1（ログと評価用。PWA は読まない）と Capture.l1Probs（ソフトラベル）に載る。
// 要件: docs/changes/2026-11-03-b-l1-local-jev.md §3.3、要件定義書 原本 第 7 章。仕様: docs/specs/schema-judge/。

/** AlertFlag.l1 — L1 の答え・校正後 confidence・L0 を上書きしたか・L1 の所要時間（ms）。 */
export const L1ResultSchema = z.strictObject({
  alert_level: AlertLevel,
  /** 校正後 confidence（0〜1）。上書きは 0.9 以上のときだけ（B2-5） */
  conf: z.number().min(0).max(1),
  overrode: z.boolean(),
  latencyMs: z.number().min(0),
})
export type L1Result = z.infer<typeof L1ResultSchema>

const Probability = z.number().min(0).max(1)

/**
 * Capture.l1Probs — 質問ごとの確率。alert_level は 3 値、noul の 3 問は「そうだ」の p。
 * 3 値の合計が 1 かどうかは検査しない（JSON Schema で表せず、TS だけ厳しくすると 3 つが食い違う）。
 */
export const L1ProbsSchema = z.strictObject({
  alert_level: z.strictObject({
    none: Probability,
    zone: Probability,
    danger: Probability,
  }),
  on_roadway: Probability,
  static_shoulder: Probability,
  false_positive: Probability,
})
export type L1Probs = z.infer<typeof L1ProbsSchema>
