import { initialLang } from '@antler/trip'
import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { useStopDeck } from '../hooks/useStopDeck'
import { useTripEventLog } from '../hooks/useTripEventLog'
import { CHOICE_TEXT, fillText, SCENE_TEXT, STOP_TEXT } from '../text'
import type { SceneChoice, StopScene } from '../types'
import { newRunId } from '../utils/event-sender'
import { hhmm } from '../utils/format'
import { writingFor } from '../utils/scenes'
import { StopSceneModal } from './StopSceneModal'
import './stop-events.css'

// 確認用の画面 /trip/:id/day/:n/stops（docs/specs/stop-events/functional.md R12・UI-4h）。
// 運転への組み込み（drive-link）の前に、その日の場面を順に開いて選べる。デモの予備にもする。
// 選んだら choice をイベントログに送る（所有者の端末だけ）。アラートの ON / OFF は ?alert=off（A-2 と同じ合図）。

export function StopScenesPage() {
  const params = useParams()
  const [search] = useSearchParams()
  const tripId = params['id'] ?? ''
  const day = Number(params['n'])
  const alertEnabled = search.get('alert') !== 'off'
  // 確認用の画面は旅の言語を読まないので、ブラウザの言語（A-1 の初期値と同じ決め方）
  const lang = initialLang(typeof navigator === 'undefined' ? [] : navigator.languages)
  const [runId] = useState(newRunId)
  const [openSceneId, setOpenSceneId] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  const deck = useStopDeck(tripId, day)
  const events = useTripEventLog(tripId, { runId, alertEnabled })

  const data = deck.data
  const openScene = data?.deck.scenes.find((s) => s.id === openSceneId) ?? null

  const choose = (scene: StopScene, choice: SceneChoice) => {
    const trigger = scene.trigger
    events.log({
      kind: 'choice',
      day,
      at: scene.at,
      sceneId: scene.id,
      choiceId: choice.id,
      ...(trigger.kind === 'road'
        ? { leg: trigger.leg, km: trigger.km }
        : { leg: trigger.beforeLeg }),
    })
    const label = writingFor(data?.writing, scene.id)?.choices.find((c) => c.id === choice.id)
    setChosen(label?.label[lang] ?? CHOICE_TEXT[choice.kind][lang])
    setOpenSceneId(null)
  }

  return (
    <main className="stop-page" data-theme="trip">
      <h1 className="stop-page__title">
        {fillText(STOP_TEXT.previewHeading[lang], { n: Number.isInteger(day) ? day : '?' })}
      </h1>
      {!deck.hasOwner ? <p>{STOP_TEXT.previewNoOwner[lang]}</p> : null}
      {deck.hasOwner && deck.isPending ? (
        <p role="status">{STOP_TEXT.previewLoading[lang]}</p>
      ) : null}
      {deck.isError ? (
        <div role="alert" className="stop-page__error">
          <p>{STOP_TEXT.previewFailed[lang]}</p>
          <button
            type="button"
            className="stop-choice stop-choice--primary"
            onClick={() => {
              void deck.refetch()
            }}
          >
            {STOP_TEXT.previewRetry[lang]}
          </button>
        </div>
      ) : null}
      {data && data.deck.scenes.length === 0 ? <p>{STOP_TEXT.previewEmpty[lang]}</p> : null}
      {data ? (
        <ol className="stop-page__list">
          {data.deck.scenes.map((scene) => {
            const w = writingFor(data.writing, scene.id)
            const title =
              w?.headline[lang] ??
              (scene.kind === 'pleasure' ? scene.id : SCENE_TEXT[scene.kind][lang])
            return (
              <li key={scene.id}>
                <button
                  type="button"
                  className="stop-choice"
                  onClick={() => {
                    setOpenSceneId(scene.id)
                  }}
                >
                  <span className="stop-choice__title">
                    <span className="stop-num">{hhmm(scene.at)}</span>
                    <span className="stop-choice__label">{title}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      ) : null}
      {chosen ? (
        <p role="status" className="stop-page__chosen">
          {fillText(STOP_TEXT.previewChosen[lang], { label: chosen })}
        </p>
      ) : null}
      {data && openScene ? (
        <StopSceneModal
          key={openScene.id}
          scene={openScene}
          writing={writingFor(data.writing, openScene.id)}
          lang={lang}
          alertEnabled={alertEnabled}
          date={data.deck.date}
          onChoose={(choice) => {
            choose(openScene, choice)
          }}
        />
      ) : null}
    </main>
  )
}
