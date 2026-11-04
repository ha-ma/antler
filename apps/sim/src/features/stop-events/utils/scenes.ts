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

/** 場面の Claude の文。無ければ null（決まった言い回しで出す。UI-4d） */
export function writingFor(writing: StopWriting | undefined, sceneId: string): SceneWriting | null {
  return writing?.scenes.find((s) => s.id === sceneId) ?? null
}
