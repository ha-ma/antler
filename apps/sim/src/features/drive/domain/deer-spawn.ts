import type { DeerCandidate, DeerMotion, DeerPattern } from '../types'
import { between, createRng, deriveSeed, type Rng } from './rng'

// 鹿の出現（A5-2、drive-deer R1）。候補はルートを作るときに 1 回だけシードで決め、すべて出る。
// 鹿ゾーンの区間ごとに遭遇を 3〜8 回（回数は危険度と種から）。車が候補の DECIDE_AHEAD_M 手前に来たら鹿を置く。
// 同じシードなら同じ鹿が同じ場所に、同じ動きで出る。

/** 車がこの距離まで来たら鹿を置く（m） */
export const DECIDE_AHEAD_M = 300
/** 区間の入口・出口から離す長さ（m） */
const EDGE_MARGIN_M = 80
/** 区間ごとの遭遇の回数（drive-deer R1） */
export const MIN_ENCOUNTERS = 3
export const MAX_ENCOUNTERS = 8
/** 危険度が引けないとき（テスト）の危険度 */
const DEFAULT_RISK = 0.5
/** 区間ごとに別に置く目の反射だけの鹿（回数に入れない） */
const MAX_EYESHINE = 2

/** 動き → 記録の語（A5-2 の 5 つ） */
export const MOTION_PATTERN: Record<DeerMotion, DeerPattern> = {
  graze: 'roadside',
  eyeshine: 'eyeshine',
  cross: 'crossing',
  'stop-midway': 'crossing',
  'turn-back': 'crossing',
  diagonal: 'crossing',
  parallel: 'crossing',
  dart: 'crossing',
  'graze-dash': 'crossing',
  herd: 'herd',
  follower: 'herd',
  frozen: 'frozen',
}

/** 遭遇の動きの重み（eyeshine を除く 11 種。推奨で決定） */
export const MOTION_WEIGHTS: Record<Exclude<DeerMotion, 'eyeshine'>, number> = {
  cross: 0.14,
  dart: 0.12,
  'graze-dash': 0.1,
  herd: 0.1,
  'stop-midway': 0.09,
  'turn-back': 0.08,
  diagonal: 0.08,
  follower: 0.08,
  graze: 0.08,
  parallel: 0.07,
  frozen: 0.06,
}

/** 至近の飛び出し（区間ごとに少なくとも 1 回。drive-deer R1） */
export const NEAR_MOTIONS: readonly DeerMotion[] = ['dart', 'graze-dash']

/** 候補どうしの間の最小（m）。短い区間で鹿が重ならない（3 回は下回らない） */
const MIN_SPACING_M = 60

/** 危険度（0〜1）と u（0〜1）から、区間の遭遇の回数（3〜8。危険度 0.8 で 5〜8、0.1 で 3〜6） */
export function encounterCount(risk: number, u: number): number {
  const x = Math.min(0.9999, Math.max(0, 0.55 * risk + 0.45 * u))
  return MIN_ENCOUNTERS + Math.floor((MAX_ENCOUNTERS - MIN_ENCOUNTERS + 1) * x)
}

/**
 * ゾーン区間の中に候補を作る（drive-deer UC-1a〜UC-1e）。
 * riskOf(区間の番号) はその区間の危険度（しおりどおりに入口に着く時刻の zoneRisk）。無ければ 0.5
 */
export function createCandidates(
  plan: { intervals: readonly { entryKm: number; exitKm: number }[] },
  seed: number,
  riskOf?: (interval: number) => number,
): DeerCandidate[] {
  const out: DeerCandidate[] = []
  plan.intervals.forEach((interval, i) => {
    const rng = createRng(deriveSeed(seed, `interval-${i}`))
    const risk = riskOf ? riskOf(i) : DEFAULT_RISK
    let entryM = interval.entryKm * 1000 + EDGE_MARGIN_M
    let exitM = interval.exitKm * 1000 - EDGE_MARGIN_M
    // 短い区間は際まで使う
    if (exitM - entryM < MIN_ENCOUNTERS * MIN_SPACING_M) {
      entryM = interval.entryKm * 1000
      exitM = Math.max(entryM + 1, interval.exitKm * 1000)
    }
    // 候補の間を 60 m 以上にする（3 回は下回らない）
    const fits = Math.max(MIN_ENCOUNTERS, Math.floor((exitM - entryM) / MIN_SPACING_M))
    const count = Math.min(encounterCount(risk, rng()), fits)
    const motions = drawMotions(rng, count)
    const slot = (exitM - entryM) / count
    motions.forEach((motion, k) => {
      const candidateSeed = deriveSeed(seed, `deer-${i}-${k}`)
      const r = createRng(candidateSeed)
      const s = entryM + slot * (k + between(r, 0.25, 0.75))
      out.push(candidate(`d${i}-${k}`, i, s, motion, r, candidateSeed))
    })
    // 目の反射だけの鹿（薄暮・夜の手がかり）。回数に入れない
    const eyes = Math.floor(rng() * (MAX_EYESHINE + 1))
    for (let k = 0; k < eyes; k++) {
      const candidateSeed = deriveSeed(seed, `eyes-${i}-${k}`)
      const r = createRng(candidateSeed)
      const s = between(r, entryM, exitM)
      out.push(candidate(`e${i}-${k}`, i, s, 'eyeshine', r, candidateSeed))
    }
  })
  return out.sort((a, b) => a.s - b.s)
}

function candidate(
  id: string,
  interval: number,
  s: number,
  motion: DeerMotion,
  rng: Rng,
  seed: number,
): DeerCandidate {
  const side = rng() < 0.5 ? 'L' : 'R'
  const herdSize = motion === 'herd' ? 2 + Math.floor(rng() * 4) : motion === 'follower' ? 2 : 1
  return { id, interval, s, pattern: MOTION_PATTERN[motion], motion, side, herdSize, seed }
}

/** 重み付きで重複なしに count 個引く。至近の飛び出しが無ければ、種で選んだ 1 つを替える */
function drawMotions(rng: Rng, count: number): DeerMotion[] {
  const bag = { ...MOTION_WEIGHTS } as Record<string, number>
  const out: DeerMotion[] = []
  for (let k = 0; k < count; k++) {
    const keys = Object.keys(bag)
    const total = keys.reduce((sum, key) => sum + (bag[key] ?? 0), 0)
    let x = rng() * total
    let picked = keys[keys.length - 1] as string
    for (const key of keys) {
      x -= bag[key] ?? 0
      if (x < 0) {
        picked = key
        break
      }
    }
    out.push(picked as DeerMotion)
    delete bag[picked]
  }
  if (!out.some((m) => NEAR_MOTIONS.includes(m))) {
    // 出口の前が必ず飛び出しにならないように、替える位置も種で選ぶ
    const at = Math.floor(rng() * out.length)
    out[at] = NEAR_MOTIONS[Math.floor(rng() * NEAR_MOTIONS.length)] as DeerMotion
  }
  return out
}

/** 車の道のり carS から見て、いま鹿を置く候補（まだ置いていないもの、DECIDE_AHEAD_M 以内）（UC-5d） */
export function candidatesToDecide(
  candidates: readonly DeerCandidate[],
  decided: ReadonlySet<string>,
  carS: number,
): DeerCandidate[] {
  return candidates.filter(
    (c) => !decided.has(c.id) && c.s - carS <= DECIDE_AHEAD_M && c.s - carS > 0,
  )
}
