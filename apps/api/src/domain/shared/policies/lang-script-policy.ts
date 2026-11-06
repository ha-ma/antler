import type { TripLang } from '../../trips/models/trip-writing.js'

// Claude の出力（しおり・出来事の場面・喪失文・車内の会話）の言語ごとの文字種（docs/specs/i18n/functional.md R8）。
// 4 つの口の検証が同じ規則を使う。Domain は外部のパッケージに依存しないので、@antler/i18n-check の
// scriptProblems(lang, text, { mode: 'output' }) と同じ判定をここに持ち、lang-script-policy.test.ts が両者の一致を確かめる。
// - ja: 仮名か漢字を含み、ハングルを含まない
// - en: ラテン文字を含み、仮名・ハングルを含まない（標識と同じ漢字の地名の併記は許す）
// - zh（繁体字）: 漢字を含み、仮名・ハングルを含まない。簡体字（決まった字の一覧）は simplified
// - ko: ハングルを含み、仮名を含まない（漢字語は許す）

export type LangScriptProblem = 'script' | 'simplified'

const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u
const HAN = /\p{Script=Han}/u
const HANGUL = /\p{Script=Hangul}/u
const LATIN = /\p{Script=Latin}/u
const PLACEHOLDER = /\{\w+\}/g

/** zh に出たら簡体字とみなす字（@antler/i18n-check の SIMPLIFIED_CHARS と同じ。テストが一致を確かめる） */
export const SIMPLIFIED_CHARS =
  '们这车开说话没还现边过时会对见么风乐东发门问间关动鱼鸟马个为进远语请让认识题页显选择线级统计记设资费买卖电飞机场专业华号难与广达运输转务实热点习乡书闭雾绿湿冻积结驾驶预览顶岛纪录历钟钱银铁阳阴观经续总应该'
const SIMPLIFIED = new RegExp(`[${SIMPLIFIED_CHARS}]`, 'u')

const SCRIPT_OK: Record<TripLang, (text: string) => boolean> = {
  ja: (t) => (KANA.test(t) || HAN.test(t)) && !HANGUL.test(t),
  en: (t) => LATIN.test(t) && !KANA.test(t) && !HANGUL.test(t),
  zh: (t) => HAN.test(t) && !KANA.test(t) && !HANGUL.test(t),
  ko: (t) => HANGUL.test(t) && !KANA.test(t),
}

/** 1 つの文の文字種の問題（無ければ空） */
export function langScriptProblems(lang: TripLang, text: string): LangScriptProblem[] {
  const body = text.replace(PLACEHOLDER, '')
  const problems: LangScriptProblem[] = []
  if (!SCRIPT_OK[lang](body)) problems.push('script')
  if (lang === 'zh' && SIMPLIFIED.test(body)) problems.push('simplified')
  return problems
}
