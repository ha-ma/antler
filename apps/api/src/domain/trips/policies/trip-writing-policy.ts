import {
  TRIP_LANGS,
  type LocalizedText,
  type TripLang,
  type TripWriting,
} from '../models/trip-writing.js'
import { langScriptProblems } from '../../shared/policies/lang-script-policy.js'
import { NOTE_MAX_LENGTH, TITLE_MAX_LENGTH } from '../rules/trip-rules.js'

// Claude の出力の検証（docs/specs/plan-trip/functional.md R5・UC-5）。
// 4 言語がそろい空でない・各日の説明の数と順が日数と同じ・タイトル 200 字以下・絵文字なし・
// 3 桁以上の数／%／件／円を含まない（統計を書かせない）・言語ごとの文字種（訳し忘れ・言語の取り違え）。
// 外れた理由をコードで返す（本文はログに出さない）。usecase はどれに外れても 1 回だけ作り直す。

export type TripWritingProblemCode =
  | 'empty'
  | 'too-long'
  | 'day-count'
  | 'day-order'
  | 'emoji'
  | 'number'
  | 'forbidden-symbol'
  | 'script'
  | 'simplified'

export type TripWritingProblem = { code: TripWritingProblemCode; path: string }

const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u{FE0F}/u
/** 3 桁以上の数（全角も）。桁区切りのある数も、区切りの後ろの 3 桁で当たる */
const THREE_DIGITS = /[0-9０-９]{3,}/
const FORBIDDEN_SYMBOLS = /[%％件円]/

function checkText(text: string, lang: TripLang, path: string, max: number): TripWritingProblem[] {
  const problems: TripWritingProblem[] = []
  if (text.trim().length === 0) return [{ code: 'empty', path }]
  // 長さは UTF-16 の単位で数える（@antler/schema の z.string().max と同じ数え方）
  if (text.length > max) problems.push({ code: 'too-long', path })
  if (EMOJI.test(text)) problems.push({ code: 'emoji', path })
  if (THREE_DIGITS.test(text)) problems.push({ code: 'number', path })
  if (FORBIDDEN_SYMBOLS.test(text)) problems.push({ code: 'forbidden-symbol', path })
  // 言語ごとの文字種（訳し忘れ・言語の取り違え・zh の簡体字。4 つの口で共通。i18n R8）
  for (const code of langScriptProblems(lang, text)) problems.push({ code, path })
  return problems
}

/** 4 言語の文を 1 つずつ検査する（喪失文の検証 loss-story-policy も使う） */
export function checkLocalized(
  value: Partial<LocalizedText>,
  path: string,
  max: number,
): TripWritingProblem[] {
  return TRIP_LANGS.flatMap((lang) => {
    const text = value[lang]
    return typeof text === 'string'
      ? checkText(text, lang, `${path}.${lang}`, max)
      : [{ code: 'empty' as const, path: `${path}.${lang}` }]
  })
}

/**
 * Claude の出力を検証する。問題が無ければ空配列。
 * @param dayNumbers しおりの days[].day（1〜N の連番）。dayNotes は同じ数・同じ順
 */
export function validateTripWriting(
  writing: TripWriting,
  dayNumbers: readonly number[],
): TripWritingProblem[] {
  const problems = checkLocalized(writing.titles, 'titles', TITLE_MAX_LENGTH)
  if (writing.dayNotes.length !== dayNumbers.length) {
    problems.push({ code: 'day-count', path: 'dayNotes' })
  }
  writing.dayNotes.forEach((entry, i) => {
    if (dayNumbers[i] !== entry.day) {
      problems.push({ code: 'day-order', path: `dayNotes.${String(i)}` })
    }
    problems.push(...checkLocalized(entry.note, `dayNotes.${String(i)}`, NOTE_MAX_LENGTH))
  })
  return problems
}
