import { langScriptProblems } from '../../shared/policies/lang-script-policy.js'
import { TRIP_LANGS, type LocalizedText, type TripLang } from '../../trips/models/trip-writing.js'
import type { StopDeck } from '../models/stop-deck.js'
import type { StopWriting } from '../models/stop-writing.js'
import {
  BODY_MAX_LENGTH,
  CHOICE_NOTE_MAX_LENGTH,
  HEADLINE_MAX_LENGTH,
  LABEL_MAX_LENGTH,
} from '../rules/stop-rules.js'

// Claude の出来事の文の検証（docs/specs/stop-events/functional.md R7）。
// plan-trip の validateTripWriting と同じ考え（4 言語・絵文字・3 桁以上の数・%/件/円・言語ごとの文字種）に、
// 束との一致（場面と選択肢の id・数・順）と、時刻・¥・$ の禁止を足した（時刻と金額は画面が計算値を出す）。
// 外れた理由をコードで返す（本文はログに出さない）。

export type StopWritingProblemCode =
  | 'empty'
  | 'too-long'
  | 'scene-count'
  | 'scene-order'
  | 'choice-count'
  | 'choice-order'
  | 'emoji'
  | 'number'
  | 'forbidden-symbol'
  | 'clock-time'
  | 'digit'
  | 'script'
  | 'simplified'

export type StopWritingProblem = { code: StopWritingProblemCode; path: string }

const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u{FE0F}/u
const THREE_DIGITS = /[0-9０-９]{3,}/
/** 統計・金額の記号（plan-trip と同じ ＋ ¥・$） */
const FORBIDDEN_SYMBOLS = /[%％件円¥￥$＄]/
const DIGIT = '[0-9０-９]'
/**
 * 時刻に使う漢数字。「一」は外す（「一時的」「一時停止」「有一點」の誤検出。code-reviewer W1）。
 * 「一時」「十一時」のような時刻は数字で書かれることがほとんどなので、見逃しは許す
 */
const KANJI_NUMBER = '[二三四五六七八九十]'
/**
 * 数のあとの金額の単位（zh の 元・圓・萬・塊、ko の 원・엔・만・천）。
 * 単位の字だけでは禁止しない（「元気」「원하다」「엔진」を通す）
 */
const MONEY_UNIT = new RegExp(
  `[0-9０-９〇一二三四五六七八九十百千萬万兩两]\\s*(?:元|圓|萬|万|塊)|${DIGIT}\\s*(?:원|엔|만|천)`,
  'u',
)
/** 時刻: 16:20・１６：２０・16時・四時（「1時間」は除く）・4시（「4시간」は除く）・4點・四點 */
const CLOCK_TIME = new RegExp(
  [
    `${DIGIT}{1,2}\\s*[:：]\\s*${DIGIT}{2}`,
    `(?:${DIGIT}|${KANJI_NUMBER}){1,3}\\s*時(?!間)`,
    `${DIGIT}{1,2}\\s*시(?!간)`,
    `(?:${DIGIT}|${KANJI_NUMBER}){1,3}\\s*點`,
  ].join('|'),
  'u',
)
/** 言い回し・一言の数字（横に画面が計算値を出すので、数字を一切書かせない） */
const ANY_DIGIT = /[0-9０-９]/

type TextRule = { max: number; noDigits: boolean }

function checkText(
  text: string,
  lang: TripLang,
  path: string,
  rule: TextRule,
): StopWritingProblem[] {
  if (text.trim().length === 0) return [{ code: 'empty', path }]
  const problems: StopWritingProblem[] = []
  if (text.length > rule.max) problems.push({ code: 'too-long', path })
  if (EMOJI.test(text)) problems.push({ code: 'emoji', path })
  if (THREE_DIGITS.test(text)) problems.push({ code: 'number', path })
  else if (rule.noDigits && ANY_DIGIT.test(text)) problems.push({ code: 'digit', path })
  if (FORBIDDEN_SYMBOLS.test(text) || MONEY_UNIT.test(text)) {
    problems.push({ code: 'forbidden-symbol', path })
  }
  if (CLOCK_TIME.test(text)) problems.push({ code: 'clock-time', path })
  // 言語ごとの文字種（4 つの口で共通。i18n R8）
  for (const code of langScriptProblems(lang, text)) problems.push({ code, path })
  return problems
}

function checkLocalized(
  value: Partial<LocalizedText>,
  path: string,
  rule: TextRule,
): StopWritingProblem[] {
  return TRIP_LANGS.flatMap((lang) => {
    const text = value[lang]
    return typeof text === 'string'
      ? checkText(text, lang, `${path}.${lang}`, rule)
      : [{ code: 'empty' as const, path: `${path}.${lang}` }]
  })
}

const HEADLINE: TextRule = { max: HEADLINE_MAX_LENGTH, noDigits: false }
const BODY: TextRule = { max: BODY_MAX_LENGTH, noDigits: false }
const LABEL: TextRule = { max: LABEL_MAX_LENGTH, noDigits: true }
const NOTE: TextRule = { max: CHOICE_NOTE_MAX_LENGTH, noDigits: true }

/** Claude の出力を束と照らして検証する。問題が無ければ空配列 */
export function validateStopWriting(
  writing: StopWriting,
  deck: Pick<StopDeck, 'scenes'>,
): StopWritingProblem[] {
  const problems: StopWritingProblem[] = []
  if (writing.scenes.length !== deck.scenes.length) {
    problems.push({ code: 'scene-count', path: 'scenes' })
  }
  writing.scenes.forEach((scene, i) => {
    const path = `scenes.${String(i)}`
    const expected = deck.scenes[i]
    if (!expected || expected.id !== scene.id) problems.push({ code: 'scene-order', path })
    problems.push(...checkLocalized(scene.headline, `${path}.headline`, HEADLINE))
    problems.push(...checkLocalized(scene.body, `${path}.body`, BODY))
    if (expected && scene.choices.length !== expected.choices.length) {
      problems.push({ code: 'choice-count', path: `${path}.choices` })
    }
    scene.choices.forEach((choice, j) => {
      const choicePath = `${path}.choices.${String(j)}`
      if (expected && expected.choices[j]?.id !== choice.id) {
        problems.push({ code: 'choice-order', path: choicePath })
      }
      problems.push(...checkLocalized(choice.label, `${choicePath}.label`, LABEL))
      problems.push(...checkLocalized(choice.note, `${choicePath}.note`, NOTE))
    })
  })
  return problems
}
