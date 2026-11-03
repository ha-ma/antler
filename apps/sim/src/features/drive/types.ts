import type { DerivedAlert, GpsZone } from '@antler/alert-ui'
import type { ReceivedFlag, TripPlan } from '@antler/schema'
import type { LightPeriod, LonLat, RoutePlan } from '@antler/zones'
import type { DetectorState } from './domain/detection'
import type { Rng } from './domain/rng'
import type { RoadFrame } from './domain/road'

// drive の型（docs/specs/drive-3d/functional.md）。シミュレーションは domain/ の純粋関数で進め、
// 3D（scene/）と HUD（components/）は World を読むだけにする。

/** 路面（R3。制動距離の係数とグリップ） */
export type Surface = 'dry' | 'wet' | 'packed-snow' | 'ice'
/** 天候（R6。検知の確率） */
export type Weather = 'clear' | 'cloudy' | 'snow' | 'fog'

/** 運転の場面（R1）。plan-trip ができたら、その TripPlan とルートから作る */
export type DriveScenario = {
  trip: TripPlan
  day: number
  /** その日のルート（緯度経度の折れ線） */
  route: LonLat[]
  /** 出発時刻（ISO 8601、+09:00） */
  startAt: string
  surface: Surface
  weather: Weather
  /** アラート ON/OFF（旅程の alertEnabled か URL の ?alert=off） */
  alertEnabled: boolean
}

/** キー入力（R3）。押されているか */
export type DriveInput = {
  /** W */
  throttle: boolean
  /** S（減速、止まっていれば後退） */
  back: boolean
  /** A */
  left: boolean
  /** D */
  right: boolean
  /** Space */
  brake: boolean
}

export const NO_INPUT: DriveInput = {
  throttle: false,
  back: false,
  left: false,
  right: false,
  brake: false,
}

/** 車の状態（R2・R3）。ルート上の道のり s と、中心線からの横の位置 d（右が正）が真値 */
export type VehicleState = {
  /** ルートの始点からの道のり（m） */
  s: number
  /** 中心線からの横の位置（m、進む向きの右が正。左車線の中央は -1.75） */
  d: number
  /** 速さ（m/s、後退は負） */
  speed: number
  /** 横に動く速さ（m/s） */
  lateralSpeed: number
}

/** 鹿の出現パターン（R5） */
export type DeerPattern = 'roadside' | 'eyeshine' | 'crossing' | 'herd' | 'frozen'

/** ゾーン区間の中の、鹿が出るかもしれない地点（ルート生成時に 1 回だけ決める） */
export type DeerCandidate = {
  id: string
  /** 区間の番号（RoutePlan.intervals の添字） */
  interval: number
  /** 道のり（m） */
  s: number
  /** 出るかの乱数（0〜1） */
  u: number
  pattern: DeerPattern
  /** 出る側（車から見て） */
  side: 'L' | 'R'
  /** 群れの頭数（herd のときだけ 2〜5、ほかは 1） */
  herdSize: number
  /** この候補の動きと検知に使う乱数の種 */
  seed: number
}

/** 鹿の動きの段階（アニメーションの切り替えに使う） */
export type DeerPose = 'idle' | 'walk' | 'run' | 'look'

/** シーンにいる鹿 1 頭 */
export type Deer = {
  id: string
  candidateId: string
  pattern: DeerPattern
  /** 群れの中の順番（0 から） */
  index: number
  /** 道のり（m） */
  s: number
  /** 中心線からの横の位置（m、右が正） */
  d: number
  /** 体の向き（rad。0 は道の進む向き、正は右回り＝右を向く） */
  heading: number
  pose: DeerPose
  /** 林の中で車のカメラから隠れているか（R6 の遮蔽） */
  occluded: boolean
  /**
   * いまの段階（pose）が始まった時刻（World.t、ms）。まだ動き出していなければ null。
   * 群れの 2 頭目以降は、渡り始める予定の未来の時刻を入れて look で待つ（deer-motion.ts）
   */
  startedAt: number | null
  /** 去った（シーンから消してよい） */
  gone: boolean
}

/** 再生速度（R4） */
export type PlaybackRate = 1 | 4 | 16

export type Playback = {
  rate: PlaybackRate
  paused: boolean
  /** ゾーン内で速度を上げられないか */
  locked: boolean
}

/** ゾーン状態（R2）。GpsZone に、HUD 用の到達予定と区間の番号を足したもの */
export type ZoneStatus = {
  gps: Extract<GpsZone, { status: 'inside' | 'outside' }>
  /** いまいる区間（inside のとき） */
  interval: number | null
  /** 次の区間の入口までの道のり（km）。無ければ null */
  nextEntryKm: number | null
  /** ルート上の道のり（km） */
  positionKm: number
}

/** 遭遇の記録（R9） */
export type Encounter = {
  deerId: string
  pattern: DeerPattern
  /** 赤が出た時刻（World.t、ms）。出ていなければ null */
  alertAt: number | null
  /** アラートのあとに最初に Space / S を押した時刻 */
  brakeAt: number | null
  /** アラート→ブレーキ（ms）。アラート OFF・ブレーキなしは null */
  alertToBrakeMs: number | null
  /** 最接近距離（m） */
  closestM: number
  outcome: 'avoided' | 'collided' | 'pending'
}

export type DriveOutcome = 'driving' | 'collided' | 'completed'

/** シミュレーションの全状態。domain/simulation.ts が進める */
export type World = {
  scenario: DriveScenario
  plan: RoutePlan
  /** シミュレーションの経過（ms、再生速度を掛けたもの）。時計は startAt + t */
  t: number
  vehicle: VehicleState
  input: DriveInput
  playback: Playback
  zone: ZoneStatus
  light: LightPeriod
  candidates: DeerCandidate[]
  /** 出るか決めた候補の id */
  decided: Set<string>
  deer: Deer[]
  /** 最後に作ったフラグとその時刻（A がシミュレーターとして作る ReceivedFlag） */
  flag: ReceivedFlag | null
  flagAt: number | null
  alert: DerivedAlert
  encounters: Encounter[]
  outcome: DriveOutcome
  /** シミュレーションの内側だけで使う値（3D・HUD は読まない） */
  internal: SimInternals
}

export type SimInternals = {
  frame: RoadFrame
  /** 出発時刻（epoch ms） */
  startMs: number
  /** 固定ステップに満たない実時間の残り（ms） */
  accumulatorMs: number
  /** 次の 0.1 秒の判定の時刻（t） */
  nextTickAt: number
  /** 止まっている時間（ms） */
  stoppedMs: number
  /** 前のステップで Space か S を押していたか */
  braking: boolean
  detector: DetectorState
  /** 検知に使うシード付きの乱数 */
  detectRng: Rng
}
