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

/** 区間ごとに必ず出す頭数と、出す上限（drive-tune R2） */
export const MIN_DEER_PER_INTERVAL = 3
export const MAX_DEER_PER_INTERVAL = 100
/** 区間ごとに少なくとも作る候補の数 */
const MIN_CANDIDATES = 3

/**
 * ゾーン区間の中に候補地点を作る（drive-3d UC-5a、drive-tune UC-2a・UC-2c）。
 * 候補の間隔は 400 m（±150 m）。区間が短くて 3 つ作れないときは区間の長さの 3 等分にする。
 * 道のりの順に先頭から、群れの頭数を合わせて 3 頭に届くまでの候補は「必ず出る」
 */
export function createCandidates(plan: RoutePlan, seed: number): DeerCandidate[] {
  const out: DeerCandidate[] = []
  plan.intervals.forEach((interval, i) => {
    const entryM = interval.entryKm * 1000 + EDGE_MARGIN_M
    const exitM = interval.exitKm * 1000 - EDGE_MARGIN_M
    const step = Math.min(CANDIDATE_STEP_M, Math.max(1, exitM - entryM) / MIN_CANDIDATES)
    const jitter = Math.min(CANDIDATE_JITTER_M, step * 0.35)
    let k = 0
    let guaranteedHeads = 0
    // 最初の候補は入口から 280〜580 m（揺らぎで入口の際に寄りすぎない。短い区間はもっと手前）
    const firstM = entryM + step / 2 + jitter
    for (let base = firstM; base < exitM || k < MIN_CANDIDATES; base += step, k++) {
      const candidateSeed = deriveSeed(seed, `deer-${i}-${k}`)
      const rng = createRng(candidateSeed)
      const s = Math.min(exitM, Math.max(entryM, base + between(rng, -jitter, jitter)))
      const u = rng()
      const drawn = pickWeighted(rng, PATTERN_WEIGHTS)
      const side = rng() < 0.5 ? 'L' : 'R'
      const guaranteed = guaranteedHeads < MIN_DEER_PER_INTERVAL
      // 必ず出る鹿は「出会える」鹿にする: 林縁の目の反射だけ（林に隠れて道に出ない）は横断に替える
      // （「遭遇」は車から見える道の近くに現れること。spec-adversary M4）
      const pattern = guaranteed && drawn === 'eyeshine' ? 'crossing' : drawn
      const herdSize = pattern === 'herd' ? 2 + Math.floor(rng() * 4) : 1
      if (guaranteed) guaranteedHeads += herdSize
      out.push({
        id: `d${i}-${k}`,
        interval: i,
        s,
        u,
        pattern,
        side,
        herdSize,
        seed: candidateSeed,
        guaranteed,
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
  if (candidate.guaranteed) return true
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
