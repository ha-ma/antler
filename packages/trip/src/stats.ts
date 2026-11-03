import riskFactors from '../data/risk-factors.json'
import stats from '../data/stats.json'

// 統計の実数（A6-3）と、リスクの月別係数。コードに数字を埋めず、ここから読む（dispatch_local_rules が直書きを止める）。

/** 鹿事故・保険の統計（出典・照合状態つき）。 */
export const STATS = stats

/** 1〜12 月の係数（最大 1）。正は @antler/zones の zones.source.json（factors.test.ts が一致を確かめる）。 */
export const MONTH_FACTORS: readonly number[] = riskFactors.months

export const MONTH_FACTOR_SOURCE = riskFactors.source
