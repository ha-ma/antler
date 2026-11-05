// stop-events（A-4 観光スポット・Claude の出来事の文・イベントログ）の公開 API。仕様: docs/specs/stop-events/functional.md R12
// 運転（drive-link）からの使い方:
//   const deck = useStopDeck(tripId, day)                 // その日の束（所有者の端末だけ）
//   // drive の DriveScenario（その日の移動をつないだ 1 本の道）では道のり m で:
//   const route = { legStartsM: scenario.legStarts.map((l) => l.sM), totalM: 道の長さ }
//   scenesDueOnRoute(deck.data.deck, route, 前のフレームの sM（始めは -1）, いまの sM)
//   // 移動ごとに扱うなら scenesBeforeLeg(deck, leg)・roadScenesBetween(deck, leg, fromKm, toKm)
//   <StopSceneModal scene writing={writingFor(deck.data.writing, scene.id)} ... onChoose />
//   const events = useTripEventLog(tripId, { runId, alertEnabled }); events.log({ kind: 'choice', ... })
export { StopSceneModal, type StopSceneModalProps } from './components/StopSceneModal'
export { StopScenesPage } from './components/StopScenesPage'
export { useStopDeck, StopDeckError } from './hooks/useStopDeck'
export { useTripEventLog, type TripEventLog } from './hooks/useTripEventLog'
export { newRunId } from './utils/event-sender'
export {
  roadScenesBetween,
  sceneRouteM,
  scenesBeforeLeg,
  scenesDueOnRoute,
  writingFor,
  type RouteMap,
} from './utils/scenes'
export type {
  DeerPattern,
  SceneChoice,
  SceneChoiceResult,
  SceneWriting,
  StopDeck,
  StopScene,
  StopWriting,
  TripEventDraft,
} from './types'
