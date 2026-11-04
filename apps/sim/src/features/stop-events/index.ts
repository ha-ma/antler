// stop-events（A-4 観光スポット・Claude の出来事の文・イベントログ）の公開 API。仕様: docs/specs/stop-events/functional.md R12
// 運転（drive-link）からの使い方:
//   const deck = useStopDeck(tripId, day)                 // その日の束（所有者の端末だけ）
//   scenesBeforeLeg(deck.data.deck, leg)                  // 止まったときに出す楽しみの場面
//   roadScenesBetween(deck.data.deck, leg, fromKm, toKm)  // 走っているあいだに来た場面
//   <StopSceneModal scene writing={writingFor(deck.data.writing, scene.id)} ... onChoose />
//   const events = useTripEventLog(tripId, { runId, alertEnabled }); events.log({ kind: 'choice', ... })
export { StopSceneModal, type StopSceneModalProps } from './components/StopSceneModal'
export { StopScenesPage } from './components/StopScenesPage'
export { useStopDeck, StopDeckError } from './hooks/useStopDeck'
export { useTripEventLog, type TripEventLog } from './hooks/useTripEventLog'
export { newRunId } from './utils/event-sender'
export { roadScenesBetween, scenesBeforeLeg, writingFor } from './utils/scenes'
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
