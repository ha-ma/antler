import type { SceneWriting, StopDeck, StopScene, StopWriting } from '../types'

// 運転から、いまの場所で出す場面を選ぶ（docs/specs/stop-events/functional.md R12・UI-4g）。
// 束の場所は「しおりどおり」の移動の添字と道のり（km）。実際の車の位置との対応は drive-link が決める。

/** leg 番目の移動の前に止まっているときに出す場面（楽しみ。しおりの順） */
export function scenesBeforeLeg(deck: StopDeck, leg: number): StopScene[] {
  return deck.scenes.filter((s) => s.trigger.kind === 'stop' && s.trigger.beforeLeg === leg)
}

/** leg 番目の移動で、fromKm より先・toKm まで（fromKm < km ≤ toKm）に来た場面（ランダムの出来事） */
export function roadScenesBetween(
  deck: StopDeck,
  leg: number,
  fromKm: number,
  toKm: number,
): StopScene[] {
  return deck.scenes.filter(
    (s) =>
      s.trigger.kind === 'road' &&
      s.trigger.leg === leg &&
      s.trigger.km > fromKm &&
      s.trigger.km <= toKm,
  )
}

/**
 * drive の道のり（m）への写し（drive-link の DriveScenario。その日の移動をつないだ 1 本の道）。
 * - legStartsM: 2 つ目以降の移動の始まりの道のり（DriveScenario.legStarts[].sM の順）
 * - totalM: その日の道のりの終わり（最後の移動の到着）
 * 止まり場所 k は「k 番目の移動の始まり」（k = 0 は出発前で 0 m、最後は totalM）、
 * 移動 leg の km 地点は「その移動の始まり + km」（終わりを越えない）
 */
export type RouteMap = { legStartsM: readonly number[]; totalM: number }

export function sceneRouteM(scene: StopScene, { legStartsM, totalM }: RouteMap): number {
  const legStart = (leg: number) => (leg === 0 ? 0 : (legStartsM[leg - 1] ?? totalM))
  const trigger = scene.trigger
  if (trigger.kind === 'stop') {
    return trigger.beforeLeg === 0 ? 0 : Math.min(legStart(trigger.beforeLeg), totalM)
  }
  return Math.min(legStart(trigger.leg) + trigger.km * 1000, totalM)
}

/**
 * 道のり fromM より先・toM まで（fromM < m ≤ toM）に来た場面を、束の順に返す。
 * 運転を始めたときは fromM に -1 を渡す（出発前の楽しみ＝0 m の場面も出す）。
 * 毎フレーム「前のフレームの道のり → いまの道のり」で呼べば、同じ場面を 2 度出さない
 */
export function scenesDueOnRoute(
  deck: StopDeck,
  route: RouteMap,
  fromM: number,
  toM: number,
): StopScene[] {
  return deck.scenes.filter((s) => {
    const m = sceneRouteM(s, route)
    return m > fromM && m <= toM
  })
}

/** 場面の Claude の文。無ければ null（決まった言い回しで出す。UI-4d） */
export function writingFor(writing: StopWriting | undefined, sceneId: string): SceneWriting | null {
  return writing?.scenes.find((s) => s.id === sceneId) ?? null
}
