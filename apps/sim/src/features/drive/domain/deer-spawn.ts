import { zoneRisk, type RoutePlan, type ZoneCollection } from '@antler/zones'
import type { DeerCandidate, DeerPattern } from '../types'
import { between, createRng, deriveSeed, pickWeighted } from './rng'

// 鹿の出現（R5、A5-2）。候補地点はルートを作るときに 1 回だけシードで決め、
// 車が候補の DECIDE_AHEAD_M 手前に来たときに、その時刻の zoneRisk（月 × 光の区分 × ゾーンの重み）で出すか決める。
// 同じシード・同じ運転なら同じ鹿が同じ場所に出る。

/** 候補の間隔（m）と揺らぎ（±m） */
export const CANDIDATE_STEP_M = 400
export const CANDIDATE_JITTER_M = 150
/** 区間の入口・出口から離す長さ（m） */
const EDGE_MARGIN_M = 80
/** 車がこの距離まで来たら、出るか決める（m） */
export const DECIDE_AHEAD_M = 300
/**
 * 危険度 → 出る確率の係数。p = 1 - exp(-risk × DENSITY)。
 * 2 月の薄暮（危険度 0.10）で約 3 割、11 月の薄暮（0.79）で 9 割強。推奨で決定（ゲームとして圧縮した密度）
 */
export const DENSITY = 3.5

/** パターンの割合（推奨で決定） */
export const PATTERN_WEIGHTS: Record<DeerPattern, number> = {
  roadside: 0.3,
  eyeshine: 0.2,
  crossing: 0.25,
  herd: 0.15,
  frozen: 0.1,
}

/** ゾーン区間の中に候補地点を作る（UC-5a） */
export function createCandidates(plan: RoutePlan, seed: number): DeerCandidate[] {
  const out: DeerCandidate[] = []
  plan.intervals.forEach((interval, i) => {
    const entryM = interval.entryKm * 1000 + EDGE_MARGIN_M
    const exitM = interval.exitKm * 1000 - EDGE_MARGIN_M
    let k = 0
    // 最初の候補は入口から 280〜580 m（揺らぎで入口の際に寄りすぎない）
    const firstM = entryM + CANDIDATE_STEP_M / 2 + CANDIDATE_JITTER_M
    for (let base = firstM; base < exitM; base += CANDIDATE_STEP_M, k++) {
      const candidateSeed = deriveSeed(seed, `deer-${i}-${k}`)
      const rng = createRng(candidateSeed)
      const s = Math.min(
        exitM,
        Math.max(entryM, base + between(rng, -CANDIDATE_JITTER_M, CANDIDATE_JITTER_M)),
      )
      const u = rng()
      const pattern = pickWeighted(rng, PATTERN_WEIGHTS)
      const side = rng() < 0.5 ? 'L' : 'R'
      const herdSize = pattern === 'herd' ? 2 + Math.floor(rng() * 4) : 1
      out.push({
        id: `d${i}-${k}`,
        interval: i,
        s,
        u,
        pattern,
        side,
        herdSize,
        seed: candidateSeed,
      })
    }
  })
  return out
}

/** 危険度（0〜1）から出る確率 */
export function appearProbability(risk: number): number {
  return 1 - Math.exp(-Math.max(0, risk) * DENSITY)
}

/** その時刻にその候補の鹿が出るか（UC-5b）。区間のゾーンのうち、いちばん危険度の高いものを使う */
export function decideAppear(
  candidate: DeerCandidate,
  plan: RoutePlan,
  zones: ZoneCollection,
  at: string | number,
): boolean {
  const ids = plan.intervals[candidate.interval]?.zoneIds ?? []
  const risk = Math.max(
    0,
    ...ids.map((id) => {
      const zone = zones.features.find((z) => z.id === id)
      return zone ? zoneRisk(zone, at) : 0
    }),
  )
  return candidate.u < appearProbability(risk)
}

/** 車の道のり carS から見て、いま出るか決める候補（まだ決めていないもの、DECIDE_AHEAD_M 以内）（UC-5d） */
export function candidatesToDecide(
  candidates: readonly DeerCandidate[],
  decided: ReadonlySet<string>,
  carS: number,
): DeerCandidate[] {
  return candidates.filter(
    (c) => !decided.has(c.id) && c.s - carS <= DECIDE_AHEAD_M && c.s - carS > 0,
  )
}
