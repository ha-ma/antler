import type { Lang } from '@antler/schema'
import { placeById, pleasureById } from '@antler/trip'
import { useCallback, useId } from 'react'
import { createPortal } from 'react-dom'
import { fillText, SCENE_TEXT, STOP_TEXT } from '../text'
import type { SceneChoice, SceneWriting, StopScene } from '../types'
import { hhmm, htmlLang, timeOfDay, yen } from '../utils/format'
import { attachModalBehavior } from '../utils/modal-focus'
import { ChoiceButton } from './ChoiceButton'
import './stop-events.css'

// A-4 観光スポット（車を降りる）のモーダル（docs/specs/stop-events/functional.md R11、デザイン A4_Stop / A4_L）。
// 写真の枠・見出し・短文・数字 3 枚（滞在／使った／到着予定）・選択肢・アラートの ON / OFF。
// 選ぶまで閉じない（Esc・外側のクリックでは閉じない）。開いたら最初の選択肢にフォーカスし、Tab は中で回る。
// body 直下に portal で出し、背面を inert にする（utils/modal-focus.ts）。閉じたら開く前の要素にフォーカスを戻す。

export type StopSceneModalProps = {
  scene: StopScene
  /** Claude の文。無ければ楽しみの名前と決まった言い回しで出す（UI-4d） */
  writing: SceneWriting | null
  lang: Lang
  alertEnabled: boolean
  /** 束の日付（YYYY-MM-DD） */
  date: string
  onChoose: (choice: SceneChoice) => void
}

/** 写真の枠の数（A4-1 は 1〜3 枚。実物は Day 6） */
const PHOTO_SLOTS = 3

export function StopSceneModal({
  scene,
  writing,
  lang,
  alertEnabled,
  date,
  onChoose,
}: StopSceneModalProps) {
  const titleId = useId()
  // フォーカス・キー操作・背面の inert（ref が付いたときに 1 回、外れたら戻す。場面を変えるときは呼ぶ側が key={scene.id} で開き直す）
  const dialogRef = useCallback((dialog: HTMLDivElement | null) => {
    if (!dialog) return undefined
    return attachModalBehavior(dialog)
  }, [])

  const pleasure = scene.pleasure ? pleasureById(scene.pleasure.id) : undefined
  const pleasureName = pleasure?.name[lang] ?? null
  const headline =
    writing?.headline[lang] ??
    pleasureName ??
    (scene.kind === 'pleasure' ? '' : SCENE_TEXT[scene.kind][lang])
  const arrivalPlace = scene.arrive
    ? (placeById(scene.arrive.place)?.name[lang] ?? scene.arrive.place)
    : null
  const arrivalTime = scene.arrive ? timeOfDay(scene.arrive.at, date, lang) : null

  return createPortal(
    <div className="stop-backdrop" data-theme="trip" data-modal-root="" lang={htmlLang(lang)}>
      <div
        ref={dialogRef}
        className="stop-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="stop-photo">
          <span className="stop-photo__caption">
            {fillText(STOP_TEXT.photo[lang], {
              name: pleasureName ?? (scene.kind === 'pleasure' ? '' : SCENE_TEXT[scene.kind][lang]),
            })}
          </span>
          {scene.pleasure ? (
            <span className="stop-photo__chip">
              {fillText(STOP_TEXT.weight[lang], { n: scene.pleasure.weight })}
            </span>
          ) : null}
          {/* 写真の実物は Day 6。いまは枠だけなので、支援技術には読ませない */}
          <span className="stop-photo__dots" aria-hidden="true">
            {Array.from({ length: PHOTO_SLOTS }, (_, i) => (
              <span key={i} className={`stop-photo__dot${i === 0 ? ' stop-photo__dot--on' : ''}`} />
            ))}
          </span>
        </div>

        <div className="stop-body">
          <div className="stop-heading">
            <span className="stop-eyebrow">
              {scene.kind === 'pleasure'
                ? STOP_TEXT.eyebrowPleasure[lang]
                : STOP_TEXT.eyebrowRoad[lang]}
              {' ・ '}
              <span className="stop-num">{hhmm(scene.at)}</span>
            </span>
            <h2 id={titleId} className="stop-title">
              {headline}
            </h2>
            {writing ? <p className="stop-lead">{writing.body[lang]}</p> : null}
          </div>

          <dl className="stop-stats">
            {scene.stayMin !== null ? (
              <div className="stop-stat">
                <dt>{STOP_TEXT.stay[lang]}</dt>
                <dd className="stop-num">
                  {fillText(STOP_TEXT.minutes[lang], { n: scene.stayMin })}
                </dd>
              </div>
            ) : null}
            {scene.spentJPY !== null ? (
              <div className="stop-stat">
                <dt>{STOP_TEXT.spent[lang]}</dt>
                <dd className="stop-num">{yen(scene.spentJPY)}</dd>
              </div>
            ) : null}
            <div className="stop-stat">
              <dt>
                {arrivalPlace
                  ? fillText(STOP_TEXT.arrival[lang], { place: arrivalPlace })
                  : STOP_TEXT.noArrival[lang]}
              </dt>
              <dd className="stop-num stop-stat__arrival">{arrivalTime ?? '—'}</dd>
            </div>
          </dl>

          <div className="stop-choices" role="group" aria-label={STOP_TEXT.question[lang]}>
            <p className="stop-question">{STOP_TEXT.question[lang]}</p>
            {scene.choices.map((choice, i) => (
              <ChoiceButton
                key={choice.id}
                choice={choice}
                writing={writing?.choices.find((c) => c.id === choice.id) ?? null}
                lang={lang}
                date={date}
                primary={i === 0}
                onSelect={onChoose}
              />
            ))}
          </div>

          <p className="stop-alert">
            <span
              className={`stop-alert__dot${alertEnabled ? '' : ' stop-alert__dot--off'}`}
              aria-hidden="true"
            />
            {alertEnabled ? STOP_TEXT.alertOn[lang] : STOP_TEXT.alertOff[lang]}
          </p>
        </div>
      </div>
    </div>,
    document.body,
  )
}
