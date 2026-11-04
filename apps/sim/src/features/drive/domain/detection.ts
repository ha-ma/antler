import type { Side } from '@antler/schema'
import type { LightPeriod } from '@antler/zones'
import type { Weather, WindowFog } from '../types'
import type { PlaneXZ } from './road'
import { between, type Rng } from './rng'

// 模擬のカメラ検知とフラグ（R6、A5-3）。A は B の車載カメラの代わりにシーンの中の鹿を判定し、
// B と同じ形のフラグ（ReceivedFlag）を作る。赤の解除（1.5 秒検知なし）は A が数える（alert-ui の deriveAlertState は数えない）。

/** 検知の判定の間隔（ms） */
export const DETECT_TICK_MS = 100
/** 検知できる距離（m） */
export const DETECT_RANGE_M = 120
/** 画角（左右、度） */
export const DETECT_HALF_FOV_DEG = 35
/** 模擬の検知遅延（ms） */
export const DELAY_MIN_MS = 150
export const DELAY_MAX_MS = 400
/** 検知がこれだけ途切れたら deer:false（ms、ch5） */
export const RELEASE_MS = 1500
/** カメラは車の中心から前へこれだけ（m。フロントガラスの上） */
export const CAMERA_FORWARD_M = 1.2

const LIGHT_FACTOR: Record<LightPeriod, number> = { day: 0.95, dawn: 0.8, dusk: 0.8, night: 0.7 }
const WEATHER_FACTOR: Record<Weather, number> = { clear: 1, cloudy: 0.95, snow: 0.8, fog: 0.6 }

/** 車（カメラ）の位置と向き */
export type CameraPose = { x: number; z: number; forward: PlaneXZ; right: PlaneXZ }

export type Sighting = {
  deerId: string
  distanceM: number
  side: Side
}

/** その鹿が検知の条件（距離・画角・遮蔽）を満たすか（UC-6a・UC-6f）。満たさなければ null */
export function cameraSees(
  camera: CameraPose,
  deer: { id: string; x: number; z: number; occluded: boolean },
): Sighting | null {
  if (deer.occluded) return null
  const rx = deer.x - camera.x
  const rz = deer.z - camera.z
  const ahead = rx * camera.forward[0] + rz * camera.forward[1]
  const lateral = rx * camera.right[0] + rz * camera.right[1]
  const distanceM = Math.hypot(rx, rz)
  if (ahead <= 0 || distanceM > DETECT_RANGE_M) return null
  const angle = (Math.atan2(Math.abs(lateral), ahead) * 180) / Math.PI
  if (angle > DETECT_HALF_FOV_DEG) return null
  return { deerId: deer.id, distanceM, side: lateral < 0 ? 'L' : 'R' }
}

/** 車内の窓の曇りの係数（drive-link R6。当日の条件の windowFog。推奨で決定） */
export const WINDOW_FOG_FACTOR: Record<WindowFog, number> = {
  none: 1,
  light: 0.95,
  medium: 0.9,
  heavy: 0.85,
}

/**
 * 鹿 1 頭をカメラが捉える確率（drive-3d UC-6b、drive-link UC-3f）。光・天候・車内の窓の曇り（A2-3）で下げる。
 * 推奨で決定: 昼・晴れ・曇りなしで 0.95
 */
export function detectProbability(
  light: LightPeriod,
  weather: Weather,
  windowFog: WindowFog,
): number {
  return LIGHT_FACTOR[light] * WEATHER_FACTOR[weather] * WINDOW_FOG_FACTOR[windowFog]
}

/** フラグを作る側の状態（場面全体で 1 つ） */
export type DetectorState = {
  /** 鹿ごとの「カメラが捉えるか」（初めて条件を満たしたときに 1 回だけ引く） */
  captured: Record<string, boolean>
  /** 最初の検知の時刻（赤を出す前、模擬遅延の待ち） */
  pendingSince: number | null
  delayMs: number
  /** 赤を出しているか */
  showing: boolean
  /** どれかの鹿を最後に検知した時刻 */
  lastDetectAt: number | null
  /** 最後に検知した中でいちばん近い鹿 */
  last: Sighting | null
}

export const INITIAL_DETECTOR: DetectorState = {
  captured: {},
  pendingSince: null,
  delayMs: 0,
  showing: false,
  lastDetectAt: null,
  last: null,
}

export type DetectorOutput = {
  /** none: 何も出さない / deer: 赤を出す・出し直す（距離と左右を更新） / release: 1.5 秒途切れたので deer:false */
  kind: 'none' | 'deer' | 'release'
  /** deer のとき、いちばん近い検知中の鹿 */
  sighting: Sighting | null
  /** deer のとき、赤がこの判定で始まったか */
  started: boolean
  /** この判定で検知している鹿の id（遭遇の記録に使う） */
  detected: string[]
}

/**
 * 0.1 秒ごとの判定（UC-6b〜UC-6d・UC-6g・UC-6h）。sightings は条件（距離・画角・遮蔽）を満たした鹿、
 * rng はシード付きの検知用の列。一時停止中は呼ばない（t が進まないので何も変わらない）。
 */
export function stepDetector(
  state: DetectorState,
  t: number,
  sightings: readonly Sighting[],
  probability: number,
  rng: Rng,
): { state: DetectorState; out: DetectorOutput } {
  // 初めて条件を満たした鹿だけ、捉えるかを引く（見逃しを作る。引く順は sightings の順で決まる）
  let captured = state.captured
  for (const s of sightings) {
    if (captured[s.deerId] === undefined)
      captured = { ...captured, [s.deerId]: rng() < probability }
  }
  const hits = sightings.filter((s) => captured[s.deerId] === true)
  const nearest = hits.reduce<Sighting | null>(
    (best, s) => (best === null || s.distanceM < best.distanceM ? s : best),
    null,
  )
  const detected = hits.map((s) => s.deerId)
  let next: DetectorState = { ...state, captured }
  if (nearest) next = { ...next, lastDetectAt: t, last: nearest }
  const lapsed = next.lastDetectAt === null || t - next.lastDetectAt >= RELEASE_MS
  const none: DetectorOutput = { kind: 'none', sighting: null, started: false, detected }

  if (next.showing) {
    if (lapsed) {
      return {
        state: { ...INITIAL_DETECTOR, captured },
        out: { ...none, kind: 'release' },
      }
    }
    // 赤の間は毎回出し直す（deriveAlertState の 5 秒で捨てられない）。見えない間は最後の値
    return { state: next, out: { ...none, kind: 'deer', sighting: nearest ?? next.last } }
  }
  if (next.pendingSince === null) {
    if (!nearest) return { state: next, out: none }
    next = { ...next, pendingSince: t, delayMs: between(rng, DELAY_MIN_MS, DELAY_MAX_MS) }
  }
  if (lapsed) return { state: { ...INITIAL_DETECTOR, captured }, out: none }
  if (t - (next.pendingSince ?? t) >= next.delayMs && next.last) {
    return {
      state: { ...next, showing: true, pendingSince: null },
      out: { ...none, kind: 'deer', sighting: nearest ?? next.last, started: true },
    }
  }
  return { state: next, out: none }
}
