import type { DerivedAlert, GpsZone } from '@antler/alert-ui'
import type { ReceivedFlag, TripPlan } from '@antler/schema'
import type { DayPlan } from '@antler/trip'
import type { LightPeriod, LonLat, RoutePlan } from '@antler/zones'
import type { DetectorState } from './domain/detection'
import type { Powertrain } from './domain/powertrain'
import type { Stage } from './domain/stages'
import type { Rng } from './domain/rng'
import type { RoadFrame } from './domain/road'

// drive の型（docs/specs/drive-3d/functional.md）。シミュレーションは domain/ の純粋関数で進め、
// 3D（scene/）と HUD（components/）は World を読むだけにする。

/** 路面（R3。制動距離の係数とグリップ） */
export type Surface = 'dry' | 'wet' | 'packed-snow' | 'ice'
/** 天候（R6。検知の確率。雨は drive-season R1 で足した） */
export type Weather = 'clear' | 'cloudy' | 'rain' | 'snow' | 'fog'
/** 車内の窓の曇り（drive-link R6。検知の確率。brief-map の当日の条件と同じ語彙） */
export type WindowFog = 'none' | 'light' | 'medium' | 'heavy'
/** その日の行程を決めたデータの版（GET /api/trips/:id/day/:n の day.data） */
export type TripDayData = DayPlan['data']

/**
 * 運転の場面（drive-3d R1、drive-link R3）。旅のその日（GET /api/trips/:id/day/:n）から scenarioFromDay で作る。
 * trip の無い /drive は見本の場面（demoScenario）
 */
export type DriveScenario = {
  /** 旅から作った場面か、開発用の見本か */
  source: 'trip' | 'demo'
  trip: TripPlan
  day: number
  /** その日のルート（緯度経度の折れ線。移動をつなぎ、20 m ごとに打ち直したもの） */
  route: LonLat[]
  /** 出発時刻（ISO 8601、+09:00） */
  startAt: string
  surface: Surface
  weather: Weather
  windowFog: WindowFog
  /** 出発地と到着地（地点の slug） */
  from: string
  to: string
  /** その日の移動の距離の合計（km。A-2 の要約と同じ数） */
  distanceKm: number
  /** その日の楽しみ（しおりで確定した立ち寄りの楽しみの id。区間の案内に出す。drive-tune R4） */
  stops: string[]
  /**
   * 2 つ目以降の移動の始まり（道のり m と、しおりの出発時刻）。着いたら時計を departAt まで進める（drive-link R3）。
   * 立ち寄り（A-4、stop-events）もこれを使う
   */
  legStarts: { sM: number; departAt: string }[]
  /**
   * すべての移動（1 つ目を含む）の始まりの道のり・出発時刻・平均の速さ（m/s。距離 ÷ 所要）。
   * ステージの始まりの時計を決める（drive-tune R1）
   */
  legPace: { sM: number; departAt: string; mps: number }[]
  /** 直線で引いた概算の移動の道のりの範囲（m）。ここにはゾーンの区間も鹿も作らない（drive-link R5） */
  straightRangesM: [number, number][]
  /** 結果を決めるデータの版（旅の場面だけ。A6-4 の再生で同じ版か確かめる） */
  data: TripDayData | null
  /** 鹿の候補と検知の乱数の種（deriveSeed(旅のシード, "drive:" + 日)。drive-link R4） */
  seed: number
  /** アラート ON/OFF（URL の ?alert=off だけで決める。TripPlan は書き換えない。plan-trip R10） */
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
  /** ブレーキの強さ（0〜1）。踏んでから 0.15 秒で立ち上がる（drive-tune R3） */
  brakeLevel: number
  /** ABS が働いている（湿潤・圧雪・凍結で 10 km/h 以上のブレーキ中。drive-tune R3） */
  abs: boolean
}

/**
 * 鹿の出現パターン（R5、A5-2 の 5 つ）。遭遇の記録（A-7・イベントログ）に残す語なので増やさない。
 * 動きの種類は DeerMotion（drive-deer R3）
 */
export type DeerPattern = 'roadside' | 'eyeshine' | 'crossing' | 'herd' | 'frozen'

/**
 * 鹿の動き（drive-deer R3。12 種）。記録の語（DeerPattern）は MOTION_PATTERN で引く。
 * graze: 路肩で草をはむ / eyeshine: 林の中で目だけ光る / cross: 車が着く頃に渡る /
 * stop-midway: 中央線で止まってまた渡る / turn-back: 車線に入って引き返す / diagonal: 斜めに横切る /
 * parallel: 路肩を並走して前を横切る / dart: 森の陰から至近で飛び出す / graze-dash: 草をはんでいて急に走り出す /
 * herd: 群れが順に渡る / follower: 1 頭が渡ったあと 2 頭目が続く / frozen: 車線で立ちすくむ
 */
export type DeerMotion =
  | 'graze'
  | 'eyeshine'
  | 'cross'
  | 'stop-midway'
  | 'turn-back'
  | 'diagonal'
  | 'parallel'
  | 'dart'
  | 'graze-dash'
  | 'herd'
  | 'follower'
  | 'frozen'

/** ゾーン区間の中の、鹿が出る地点（ルート生成時に 1 回だけ決める。drive-deer R1 ですべて出る） */
export type DeerCandidate = {
  id: string
  /** 区間の番号（RoutePlan.intervals の添字） */
  interval: number
  /** 道のり（m） */
  s: number
  /** 記録の語（motion から決まる） */
  pattern: DeerPattern
  motion: DeerMotion
  /** 出る側（車から見て） */
  side: 'L' | 'R'
  /** 頭数（herd は 2〜5、follower は 2、ほかは 1） */
  herdSize: number
  /** この候補の動きと検知に使う乱数の種 */
  seed: number
}

/** 鹿の動きの段階（アニメーションの切り替えに使う） */
export type DeerPose = 'idle' | 'walk' | 'run' | 'look'

/**
 * 鹿の動きの局面（drive-deer R3）。wait: 待つ / go: 動く（startedAt が未来なら順番を待つ）/
 * pause: 途中で止まる / resume: 止まったあと渡りきる / stand: 立ちすくむ / leave: 去る（引き返す・横切る）
 */
export type DeerPhase = 'wait' | 'go' | 'pause' | 'resume' | 'stand' | 'leave'

/** シーンにいる鹿 1 頭 */
export type Deer = {
  id: string
  candidateId: string
  pattern: DeerPattern
  motion: DeerMotion
  /** 候補の種（動きの係数をここから引く。s が動く動きでも係数が変わらない） */
  seed: number
  phase: DeerPhase
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
   * いまの局面（phase）が始まった時刻（World.t、ms）。まだ動き出していなければ null。
   * go に入るときは動き出す予定の時刻（群れの 2 頭目以降・遅れて動く鹿は未来）を入れて look で待つ（deer-motion.ts）
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
  /**
   * 赤が出たときのゲーム内の時刻（JST の ISO 8601）。出ていなければ null。
   * 移動の始まりで時計を進めるので startAt + alertAt とは限らない（A-7 の記録はこちらを使う）
   */
  alertClockAt: string | null
  /** アラートのあとに最初に Space / S を押した時刻 */
  brakeAt: number | null
  /** アラート→ブレーキ（ms）。アラート OFF・ブレーキなしは null */
  alertToBrakeMs: number | null
  /** 最接近距離（m） */
  closestM: number
  outcome: 'avoided' | 'collided' | 'pending'
}

export type DriveOutcome = 'driving' | 'collided' | 'completed'

/**
 * 鹿の発見（drive-crash-spot R4・A5-5）。appeared はその走りでシーンに出た鹿の頭数（目の反射だけの鹿も含む）、
 * found は利用者がクリック / タップで見つけた頭数、early はそのうち車の前 60 m 以上で見つけた頭数
 */
export type Spotting = { appeared: number; found: number; early: number }

/** シミュレーションの全状態。domain/simulation.ts が進める */
export type World = {
  scenario: DriveScenario
  plan: RoutePlan
  /** シミュレーションの経過（ms、再生速度を掛けたもの）。時計は startAt + t */
  t: number
  vehicle: VehicleState
  /** オートマの段と回転数（drive-tune R5。ダッシュボードと音の合図） */
  powertrain: Powertrain
  input: DriveInput
  playback: Playback
  zone: ZoneStatus
  light: LightPeriod
  candidates: DeerCandidate[]
  /** 鹿を置いた候補の id（車が 300 m 手前に来たとき。drive-deer R1 ですべての候補が出る） */
  decided: Set<string>
  deer: Deer[]
  /** 最後に作ったフラグとその時刻（A がシミュレーターとして作る ReceivedFlag） */
  flag: ReceivedFlag | null
  flagAt: number | null
  alert: DerivedAlert
  encounters: Encounter[]
  /** 鹿の発見の数（drive-crash-spot R4） */
  spotting: Spotting
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
  /** 移動の始まりで時計を進めた合計（ms）。時計は startMs + t + clockShiftMs（drive-link R3） */
  clockShiftMs: number
  /** 入力が変わった時刻と入力（A-6 の「衝突の 3 秒前を見る」用。drive-link R8） */
  inputLog: { t: number; input: DriveInput }[]
  /** 衝突した鹿 */
  collidedDeerId: string | null
  /** 入った鹿ゾーンの区間の数（ゾーンの中から出発したら 1 から数える） */
  zoneEnters: number
  /** 走るステージと、いま何番目か（drive-tune R1） */
  stages: Stage[]
  stageIndex: number
  /** 最後にステージをクリアした時刻（World.t。HUD の「クリア」の帯に使う） */
  stageClearedAt: number | null
  /** ステージのクリアで、まだ前にいたまま消した鹿（遭遇の記録を pending のまま残す） */
  leftBehind: Set<string>
  /** 発見した鹿の id（同じ鹿を 2 回数えない。drive-crash-spot R4） */
  spotted: Set<string>
  /** 一度でも見えた鹿の id（発見の「出た数」。drive-crash-spot R4） */
  seen: Set<string>
}

/**
 * 走行の結果（drive-link R8）。衝突か完走のときだけ作る。A-6（loss）・A-7（record）が使う。
 * 鹿アラートの ON/OFF は TripPlan ではなく、ここ（走行の記録の側）に持つ（plan-trip R10）
 */
export type DriveResult = {
  tripId: string
  day: number
  /** 鹿の候補と検知の種（同じ値なら同じ鹿） */
  seed: number
  source: DriveScenario['source']
  data: TripDayData | null
  alertEnabled: boolean
  /** 出発時刻（ISO 8601、+09:00。場面の startAt） */
  startAt: string
  /** その走行で入った鹿ゾーンの区間の数（A7-2 のゾーン通過回数） */
  zonePasses: number
  outcome: Exclude<DriveOutcome, 'driving'>
  /** 終わった地点の道のり（m）と、何本目の移動か（0 から） */
  endS: number
  legIndex: number
  /** 終わった時刻（シミュレーションの時計、JST の ISO 8601） */
  endedAt: string
  collidedDeerId: string | null
  encounters: Encounter[]
  /** 鹿の発見（drive-crash-spot R4。A-6・A-7 に 1 行出す） */
  spotting: Spotting
  inputs: { t: number; input: DriveInput }[]
  /** rAF の要約（dropped・counted は performance R1 の落ちたフレームと数えたフレームの数。走行の全体） */
  frames: {
    fpsMedian: number
    fpsP5: number
    frames: number
    dropped: number
    counted: number
  } | null
}
