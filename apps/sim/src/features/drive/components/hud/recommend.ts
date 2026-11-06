import { placeById, type Pleasure } from '@antler/trip'
import { metersBetween } from '@antler/zones'
import { hasDeerWord, nearbyPleasures, todayPleasures } from '../../chat/tourism'
import type { DriveSnapshot } from '../../domain/engine'
import type { DriveScenario } from '../../types'
import { STAGE_BANNER_MS } from './StageBanner'

// 鹿ゾーンの前のおすすめ（docs/specs/drive-tourism/functional.md T11〜T13）。純粋関数。
// - 出しどき（T11）: 1 つのステージに 1 回、帯が消えた後から、そのステージで最初にゾーンに入る・赤になるまで
// - 出す楽しみ（T12）: 今の位置より先のその日の楽しみのうち最も近いもの。無ければ旅の月に合う到着地の楽しみをステージで回す

export type RecommendFrame = {
  /** シミュレーションの経過（ms） */
  t: number
  stage: { index: number; count: number }
  stageClearedAt: number | null
  inside: boolean
  danger: boolean
  driving: boolean
}

export type RecommendState = {
  /** 見ているステージ（初めは null） */
  stage: number | null
  /** このステージでゾーンに入ったか赤になった（もう出さない） */
  ended: boolean
  lastT: number
}

export const INITIAL_RECOMMEND: RecommendState = { stage: null, ended: false, lastT: 0 }

export function recommendFrameOf(
  s: Pick<DriveSnapshot, 't' | 'stage' | 'stageClearedAt' | 'zone' | 'alert' | 'outcome'>,
): RecommendFrame {
  return {
    t: s.t,
    stage: s.stage,
    stageClearedAt: s.stageClearedAt,
    inside: s.zone.gps.status === 'inside',
    danger: s.alert.state === 'danger',
    driving: s.outcome === 'driving',
  }
}

/** 1 フレーム進める。visible はこのフレームでカードを出すか */
export function advanceRecommend(
  previous: RecommendState,
  f: RecommendFrame,
): { state: RecommendState; visible: boolean } {
  // restart（t が戻る）は最初から
  let state = f.t < previous.lastT ? INITIAL_RECOMMEND : previous
  if (state.stage !== f.stage.index) state = { ...state, stage: f.stage.index, ended: false }
  if (f.inside || f.danger) state = { ...state, ended: true }
  state = { ...state, lastT: f.t }
  const bannerShown = f.stageClearedAt !== null && f.t - f.stageClearedAt <= STAGE_BANNER_MS
  const visible =
    f.driving && f.stage.count > 0 && !state.ended && !f.inside && !f.danger && !bannerShown
  return { state, visible }
}

/** 拠点がどの区切りからもこれより遠ければ、終点に置く（T12） */
export const STOP_MATCH_M = 15_000

/**
 * その日の楽しみの道のり（m）。拠点の地点にいちばん近い移動の区切り（始点・各移動の始まり・終点）。
 * どの区切りからも 15 km より遠い拠点は終点（その日の最後まで「先」）
 */
export function stopPositionsM(
  scenario: Pick<DriveScenario, 'stops' | 'route' | 'legStarts'>,
  totalM: number,
): { pleasure: Pleasure; atM: number }[] {
  const { route } = scenario
  const cuts = [0, ...scenario.legStarts.map((l) => l.sM), totalM]
  const pointAt = (m: number) => {
    const i = totalM > 0 ? Math.round((m / totalM) * (route.length - 1)) : 0
    return route[Math.min(route.length - 1, Math.max(0, i))]
  }
  return todayPleasures(scenario).map((pleasure) => {
    const place = placeById(pleasure.base)
    let best = { atM: totalM, d: Infinity }
    if (place) {
      for (const m of cuts) {
        const p = pointAt(m)
        if (!p) continue
        const d = metersBetween(p, [place.lon, place.lat])
        if (d < best.d) best = { atM: m, d }
      }
    }
    return { pleasure, atM: best.d <= STOP_MATCH_M ? best.atM : totalM }
  })
}

export type Recommendation = {
  pleasure: Pleasure
  /** 拠点がその日の到着地なら、到着地の時刻を出す（T13） */
  atDestination: boolean
}

/** 出す楽しみ（T12）。どれも無ければ null */
export function pickRecommendation(
  scenario: Pick<DriveScenario, 'stops' | 'to' | 'startAt'>,
  stops: readonly { pleasure: Pleasure; atM: number }[],
  positionM: number,
  stageIndex: number,
): Recommendation | null {
  const ahead = stops.filter((s) => s.atM > positionM).sort((a, b) => a.atM - b.atM)[0]
  const nearby = nearbyPleasures(scenario)
  const pleasure =
    ahead?.pleasure ?? nearby[(Math.max(1, stageIndex) - 1) % Math.max(1, nearby.length)]
  if (!pleasure) return null
  return { pleasure, atDestination: pleasure.base === scenario.to }
}

/** カードに出す一言（note）。鹿の語が入るなら出さない（T13） */
export function cardNote(note: string): string | null {
  return hasDeerWord(note) ? null : note
}
