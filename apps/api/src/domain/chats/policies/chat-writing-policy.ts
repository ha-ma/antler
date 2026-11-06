import { TRIP_LANGS, type TripLang } from '../../trips/models/trip-writing.js'
import type { ChatPlan, ChatWriting } from '../models/chat-deck.js'
import { CHAT_TEXT_MAX_LENGTH } from '../rules/chat-rules.js'

// Claude の一言の検証（docs/specs/drive-audio-chat/functional.md R17）。外れた理由をコードで返す（本文はログに出さない）。
// stop-events の検証（stop-writing-policy）と同じ考えに、数詞・鹿の語・zh の簡体字の禁止を足した。
// 正規表現はこのファイルに持つ（stop-writing-policy は export しておらず、編集しない）。

export type ChatWritingProblemCode =
  | 'line-count'
  | 'line-order'
  | 'empty'
  | 'too-long'
  | 'digit'
  | 'number-word'
  | 'forbidden-symbol'
  | 'emoji'
  | 'deer-word'
  | 'script'
  | 'simplified'

export type ChatWritingProblem = { code: ChatWritingProblemCode; path: string }

const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u{FE0F}/u
const DIGIT = /[0-9０-９]/
/** 統計・金額の記号。「件」「円」は数字と数詞の禁止で足りるので入れない（「条件」「円滑」を通す） */
const FORBIDDEN_SYMBOLS = /[%％¥￥$＄]/
/**
 * 数詞（数字を一切書かせないので、言葉で書いた大きな数も禁じる）
 * - 漢数字（ja・zh）: 2 文字以上の連なり（「六千」「一萬」）。「一緒」「十分」「千歳」「十勝」は 1 文字なので通る（「万一」は外れる）
 * - 英語: 11 以上の数と位（「one」「two」は "no one" "the two of us" で普通に出るので禁じない）
 * - 韓国語の漢数詞: 「数＋位」の形だけ（「육천」「삼만」「이십」）。連なりで禁じると「사이」「천천히」を落とす。
 *   「이만」（これで・このくらい）・「천만」（천만에요＝どういたしまして）は普通の語なので通す
 */
const KANJI_NUMBER = /[〇零一二三四五六七八九十百千万萬億兆兩两]{2,}/u
const ENGLISH_NUMBER =
  /\b(?:eleven|twelve|(?:thir|four|fif|six|seven|eigh|nine)teen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|millions?|billions?|trillions?|percent|per\s+cent|dozens?)\b/i
const KOREAN_NUMBER = /[일삼사오육칠팔구][십백천만억]|이[십백천억]|[십백][만억]|천억/u
/** 鹿を見つけた・いると言うのは赤の警告の役割（文字の偽警報を出さない）。助詞の「しか」は入れない */
const DEER_WORD = /鹿|シカ|deer|사슴/iu
/** zh でよく出る簡体字（繁体字で書かせる。R17） */
const SIMPLIFIED = /[们这车开说话没还现边过时会对见么风乐]/u

const HANGUL = /\p{Script=Hangul}/u
const KANA_OR_KANJI = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u
const KANA_OR_HANGUL = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const ASCII_LETTER = /[A-Za-z]/
const SCRIPT_OK: Record<TripLang, (text: string) => boolean> = {
  ko: (text) => HANGUL.test(text),
  ja: (text) => KANA_OR_KANJI.test(text),
  zh: (text) => !KANA_OR_HANGUL.test(text),
  en: (text) => ASCII_LETTER.test(text),
}

function checkText(text: string, lang: TripLang, path: string): ChatWritingProblem[] {
  if (text.trim().length === 0) return [{ code: 'empty', path }]
  const problems: ChatWritingProblem[] = []
  const found = (code: ChatWritingProblemCode) => problems.push({ code, path })
  if (Array.from(text).length > CHAT_TEXT_MAX_LENGTH) found('too-long')
  if (DIGIT.test(text)) found('digit')
  if (KANJI_NUMBER.test(text) || ENGLISH_NUMBER.test(text) || KOREAN_NUMBER.test(text)) {
    found('number-word')
  }
  if (FORBIDDEN_SYMBOLS.test(text)) found('forbidden-symbol')
  if (EMOJI.test(text)) found('emoji')
  if (DEER_WORD.test(text)) found('deer-word')
  if (!SCRIPT_OK[lang](text)) found('script')
  if (lang === 'zh' && SIMPLIFIED.test(text)) found('simplified')
  return problems
}

/** Claude の出力を束の計画と照らして検証する。問題が無ければ空配列 */
export function validateChatWriting(
  writing: ChatWriting,
  plan: { lines: readonly Pick<ChatPlan['lines'][number], 'id'>[] },
): ChatWritingProblem[] {
  const problems: ChatWritingProblem[] = []
  if (writing.lines.length !== plan.lines.length) {
    problems.push({ code: 'line-count', path: 'lines' })
  }
  writing.lines.forEach((line, i) => {
    const path = `lines.${String(i)}`
    if (plan.lines[i]?.id !== line.id) problems.push({ code: 'line-order', path })
    for (const lang of TRIP_LANGS) {
      const text: unknown = (line.text as Partial<Record<TripLang, unknown>>)[lang]
      if (typeof text === 'string') problems.push(...checkText(text, lang, `${path}.${lang}`))
      else problems.push({ code: 'empty', path: `${path}.${lang}` })
    }
  })
  return problems
}
