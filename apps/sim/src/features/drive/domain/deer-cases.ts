import type { ZoneCollection } from '@antler/zones'
import type { DeerMotion, DriveInput, Surface, World } from '../types'
import { NO_INPUT } from '../types'
import { MOTION_PATTERN } from './deer-spawn'
import { demoScenario } from './scenario'
import { advance, createWorld, setInput } from './simulation'

// 鹿 1 回の遭遇を頭なしで走らせる（drive-deer UC-4b・AC-2 のテスト表）。テストからだけ使う。
// 区間の中に車を置き、偶然の鹿を消して、決めた候補（動き・左右・種）だけを 300 m 先に置く。
// 検知は必ず捕捉し遅延は最短（detectRng = 0）。運転は「何もしない」か「赤から反応時間で全力ブレーキ」。

const FRAME_MS = 1000 / 60

/** none: 何もしない（速さを保つ）/ brake: 赤から反応時間で全力ブレーキ / steer: 鹿へハンドルで寄せる */
export type CaseDriver = 'none' | 'brake' | 'steer'

export type DeerCase = {
  motion: DeerMotion
  side: 'L' | 'R'
  kmh: number
  surface: Surface
  driver: CaseDriver
  seed: number
  /** 赤からブレーキまで（ms） */
  reactionMs?: number
}

export type CaseResult = {
  red: boolean
  /** 赤の始まりの side */
  firstSide: 'L' | 'R' | null
  collided: boolean
  /** 鹿が動き出したときの車との距離（m）。動かなければ null */
  startGapM: number | null
  /** 赤が始まったときの車と鹿の距離（m） */
  redGapM: number | null
}

export const DEFAULT_REACTION_MS = 750

export function runDeerCase(c: DeerCase, zones: ZoneCollection): CaseResult {
  const w: World = createWorld(
    { ...demoScenario(zones), surface: c.surface, weather: 'clear' },
    zones,
  )
  const s = (w.plan.intervals[0]?.entryKm ?? 0) * 1000 + 400
  w.vehicle = { ...w.vehicle, s, speed: c.kmh / 3.6 }
  w.playback = { rate: 1, paused: false, locked: true }
  const deerS = s + 300
  w.candidates = [
    {
      id: 'c0-0',
      interval: 0,
      s: deerS,
      pattern: MOTION_PATTERN[c.motion],
      motion: c.motion,
      side: c.side,
      herdSize: c.motion === 'herd' ? 3 : c.motion === 'follower' ? 2 : 1,
      seed: c.seed,
    },
  ]
  w.decided = new Set()
  w.internal.detectRng = () => 0
  const reaction = c.reactionMs ?? DEFAULT_REACTION_MS
  let redAt: number | null = null
  let firstSide: CaseResult['firstSide'] = null
  let startGapM: number | null = null
  let redGapM: number | null = null
  // 30 km/h でも 300 m 先の鹿を過ぎるまで（最長 60 秒）
  for (let f = 0; f < 60 * 60 && w.outcome === 'driving'; f++) {
    setInput(w, input(w, c, redAt, reaction))
    advance(w, FRAME_MS, zones)
    const lead = w.deer[0]
    if (startGapM === null && lead && lead.phase !== 'wait') startGapM = lead.s - w.vehicle.s
    if (redAt === null && w.alert.state === 'danger') {
      redAt = w.t
      firstSide = w.alert.side ?? null
      redGapM = lead ? lead.s - w.vehicle.s : null
    }
    // 鹿が車の後ろへ過ぎて、車が止まるか走り去ったら終わり
    if (w.deer.every((d) => d.gone || d.s < w.vehicle.s - 15) && w.decided.size > 0) break
    // 赤で踏んで止まりきったら、もう当たらない（5 km/h 未満は衝突にしない。R5）
    if (c.driver === 'brake' && redAt !== null && w.vehicle.speed < 0.1) break
  }
  return { red: redAt !== null, firstSide, collided: w.outcome === 'collided', startGapM, redGapM }
}

function input(w: World, c: DeerCase, redAt: number | null, reactionMs: number): DriveInput {
  if (c.driver === 'brake' && redAt !== null && w.t - redAt >= reactionMs) {
    return { ...NO_INPUT, brake: w.vehicle.speed > 0.1 }
  }
  const cruise = { ...NO_INPUT, throttle: w.vehicle.speed * 3.6 < c.kmh }
  if (c.driver !== 'steer') return cruise
  // 60 m 先までの鹿へハンドルで寄せる（当てに行く）
  const target = w.deer.find((d) => d.s - w.vehicle.s < 60 && d.s > w.vehicle.s)
  if (!target || Math.abs(target.d - w.vehicle.d) < 0.3) return cruise
  return { ...cruise, right: target.d > w.vehicle.d, left: target.d < w.vehicle.d }
}
