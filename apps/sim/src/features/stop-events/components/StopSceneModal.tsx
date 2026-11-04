import type { Lang } from '@antler/schema'
import { placeById, pleasureById } from '@antler/trip'
import { useCallback, useId, useRef } from 'react'
import { fillText, SCENE_TEXT, STOP_TEXT } from '../text'
import type { SceneChoice, SceneWriting, StopScene } from '../types'
import { hhmm, isAfterDate, yen } from '../utils/format'
import { ChoiceButton } from './ChoiceButton'
import './stop-events.css'

// A-4 観光スポット（車を降りる）のモーダル（docs/specs/stop-events/functional.md R11、デザイン A4_Stop / A4_L）。
// 写真の枠・見出し・短文・数字 3 枚（滞在／使った／到着予定）・選択肢・アラートの ON / OFF。
// 選ぶまで閉じない（Esc・外側のクリックでは閉じない）。開いたら最初の選択肢にフォーカスし、Tab は中で回る。

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
  const dialogRef = useRef<HTMLDivElement>(null)
  // 開いたら最初の選択肢にフォーカス（ref が付いたときに 1 回。場面を変えるときは呼ぶ側が key={scene.id} で開き直す）
  const focusFirstChoice = useCallback((button: HTMLButtonElement | null) => {
    button?.focus()
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
  const arrivalTime = scene.arrive
    ? isAfterDate(scene.arrive.at, date)
      ? fillText(STOP_TEXT.nextDay[lang], { time: hhmm(scene.arrive.at) })
      : hhmm(scene.arrive.at)
    : null

  // 選択肢のキー操作: Esc では閉じない（運転側のキーにも渡さない。R11）、Tab はモーダルの中で回す
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (event.key !== 'Tab') return
    const buttons = Array.from(dialogRef.current?.querySelectorAll('button') ?? [])
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="stop-backdrop" data-theme="trip">
      <div
        ref={dialogRef}
        className="stop-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
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
          <span
            className="stop-photo__dots"
            role="img"
            aria-label={fillText(STOP_TEXT.photoCount[lang], { n: PHOTO_SLOTS })}
          >
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
            <h1 id={titleId} className="stop-title">
              {headline}
            </h1>
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
                onKeyDown={onKeyDown}
                {...(i === 0 ? { buttonRef: focusFirstChoice } : {})}
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
    </div>
  )
}
