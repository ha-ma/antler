import type { Lang } from '@antler/schema'
import { placeById } from '@antler/trip'
import { CHOICE_TEXT, fillText, LIGHT_TEXT, STOP_TEXT } from '../text'
import type { SceneChoice, SceneWriting } from '../types'
import { hhmm, isAfterDate, lightWord, yen } from '../utils/format'

// 選択肢のボタン（docs/design/README.md ChoiceButton、functional.md R11・UI-4a）。
// 左寄せ、太字の言い回し＋「→ 地点 時刻 着」、clay-deep の帯で「鹿ゾーンをいつ通るか」と失うもの、Claude の一言。

type Props = {
  choice: SceneChoice
  writing: SceneWriting['choices'][number] | null
  lang: Lang
  /** 束の日付（YYYY-MM-DD。翌日の時刻に「翌」を付ける） */
  date: string
  primary: boolean
  onSelect: (choice: SceneChoice) => void
  onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void
  buttonRef?: React.Ref<HTMLButtonElement>
}

function placeName(id: string, lang: Lang): string {
  return placeById(id)?.name[lang] ?? id
}

function timeText(iso: string, date: string, lang: Lang): string {
  return isAfterDate(iso, date) ? fillText(STOP_TEXT.nextDay[lang], { time: hhmm(iso) }) : hhmm(iso)
}

export function ChoiceButton({
  choice,
  writing,
  lang,
  date,
  primary,
  onSelect,
  onKeyDown,
  buttonRef,
}: Props) {
  const label = writing?.label[lang] ?? CHOICE_TEXT[choice.kind][lang]
  const where = choice.arrive
    ? fillText(STOP_TEXT.arriveAt[lang], {
        place: placeName(choice.arrive.place, lang),
        time: timeText(choice.arrive.at, date, lang),
      })
    : choice.stayAt
      ? fillText(STOP_TEXT.stayHere[lang], { place: placeName(choice.stayAt, lang) })
      : null
  const zone = choice.zone
  const zoneText = zone
    ? fillText(STOP_TEXT.zonePass[lang], {
        km: zone.km,
        time: timeText(zone.entryAt, date, lang),
        light: LIGHT_TEXT[lightWord(zone.light, zone.entryAt, date)][lang],
      }) + (zone.count > 1 ? fillText(STOP_TEXT.zoneMore[lang], { n: zone.count - 1 }) : '')
    : STOP_TEXT.zoneNone[lang]
  const losses = [
    choice.lost.jpy > 0 ? fillText(STOP_TEXT.lostYen[lang], { yen: yen(choice.lost.jpy) }) : null,
    choice.lost.weight > 0 ? fillText(STOP_TEXT.lostWeight[lang], { n: choice.lost.weight }) : null,
    choice.lost.lateReturn ? STOP_TEXT.lateReturn[lang] : null,
  ].filter((t): t is string => t !== null)

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`stop-choice${primary ? ' stop-choice--primary' : ''}`}
      onClick={() => {
        onSelect(choice)
      }}
      {...(onKeyDown ? { onKeyDown } : {})}
    >
      <span className="stop-choice__title">
        <span className="stop-choice__label">{label}</span>
        {where ? <span className="stop-choice__where stop-num">{where}</span> : null}
      </span>
      <span className={`stop-choice__band${zone ? '' : ' stop-choice__band--calm'}`}>
        <span className="stop-num">{zoneText}</span>
        {losses.map((text) => (
          <span key={text}> ・ {text}</span>
        ))}
      </span>
      {writing ? <span className="stop-choice__note">{writing.note[lang]}</span> : null}
    </button>
  )
}
