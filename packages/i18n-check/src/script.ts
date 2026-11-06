import type { Lang } from '@antler/schema'

// 言語ごとの文字種の規則（docs/specs/i18n/functional.md R3・R8）。文言の表の検査と、
// api の Claude の出力の検証（4 つの口）が同じ定義を使う。

export const LANGS = ['ja', 'en', 'zh', 'ko'] as const satisfies readonly Lang[]

/** 文字種の規則の名前 */
export type ScriptRule = 'script' | 'simplified' | 'japanese-form'

const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u
const HAN = /\p{Script=Han}/u
const HANGUL = /\p{Script=Hangul}/u
const LATIN = /\p{Script=Latin}/u
const ANY_LETTER = /\p{L}/u
const PLACEHOLDER = /\{\w+\}/g
/** 小文字のラテン文字が 3 つ以上続く（英語の語。略語・単位の ON・4WD・km・DAY は当たらない） */
const ENGLISH_WORD = /\p{Ll}{3,}/u

/**
 * zh（繁体字）に出たら簡体字とみなす字。繁体字の文に普通は出ない字だけ
 * （云・万・后・里・台・干のように繁体字でも別の意味で使う字は入れない）
 */
export const SIMPLIFIED_CHARS =
  '们这车开说话没还现边过时会对见么风乐东发门问间关动鱼鸟马个为进远语请让认识题页显选择线级统计记设资费买卖电飞机场专业华号难与广达运输转务实热点习乡书闭雾绿湿冻积结驾驶预览顶岛纪录历钟钱银铁阳阴观经续总应该国画图园馆长陆'

/**
 * zh（繁体字）に出たら日本の新字体とみなす字（繁体字では別の字。例: 発→發、駅→驛、内→內）。
 * 文言の表の検査だけで使う（Claude の出力には当てない。R8）
 */
export const JAPANESE_FORM_CHARS =
  '発駅図転気鉄楽帰歩県読売変戻込払済険検験応広価両囲圧営沢浜渋円写実単対断様拡権黒黄説内録経続総緑恵薬雑覚学挙桜戦数弾継処区欧窓児隣遅塩豊焼湾絵縄蔵騒剤竜亀尽昼温歴横辺帯当来将状荘伝届歳静峠畑観関'

const SIMPLIFIED = new RegExp(`[${SIMPLIFIED_CHARS}]`, 'u')
const JAPANESE_FORM = new RegExp(`[${JAPANESE_FORM_CHARS}]`, 'u')

/** 文字の無い文（数字・記号・差し込みだけ）。文字種の規則を当てない */
export function hasNoLetters(text: string): boolean {
  return !ANY_LETTER.test(text.replace(PLACEHOLDER, ''))
}

/** 仮名・漢字・ハングルのどれかを含むか（中立の文の判定に使う） */
export function hasCjk(text: string): boolean {
  return KANA.test(text) || HAN.test(text) || HANGUL.test(text)
}

/** 英語の語を含むか（小文字のラテン文字が 3 つ以上続く） */
export function hasEnglishWord(text: string): boolean {
  return ENGLISH_WORD.test(text)
}

/**
 * - `table`: 文言の表（UI の固定の文）。en は漢字も許さない。略語・単位と文字の無い文は許す。新字体も見る
 * - `output`: Claude の出力（4 つの口の検証。apps/api の lang-script-policy が同じ判定を持つ）。
 *   作り直しを増やさないよう en の漢字（標識と同じ地名の併記）を許し、新字体は見ない
 */
export type ScriptMode = 'table' | 'output'

const SCRIPT_OK: Record<ScriptMode, Record<Lang, (text: string) => boolean>> = {
  table: {
    ja: (t) => (KANA.test(t) || HAN.test(t)) && !HANGUL.test(t),
    en: (t) => LATIN.test(t) && !hasCjk(t),
    zh: (t) => HAN.test(t) && !KANA.test(t) && !HANGUL.test(t),
    ko: (t) => HANGUL.test(t) && !KANA.test(t),
  },
  output: {
    ja: (t) => (KANA.test(t) || HAN.test(t)) && !HANGUL.test(t),
    en: (t) => LATIN.test(t) && !KANA.test(t) && !HANGUL.test(t),
    zh: (t) => HAN.test(t) && !KANA.test(t) && !HANGUL.test(t),
    ko: (t) => HANGUL.test(t) && !KANA.test(t),
  },
}

export type ScriptOptions = { mode?: ScriptMode }

/**
 * 1 つの文の文字種の問題を返す（無ければ空）。差し込み `{name}` は除いて見る。
 * ja: 仮名か漢字を含みハングルを含まない / en: ラテン文字を含み仮名・ハングル（table では漢字も）を含まない /
 * zh: 漢字を含み仮名・ハングルを含まない / ko: ハングルを含み仮名を含まない（漢字語は許す）。
 * table では、ja・zh・ko で仮名・漢字・ハングルを含まない文は英語の語が無ければ許し（略語・単位）、文字の無い文は見ない
 */
export function scriptProblems(
  lang: Lang,
  text: string,
  options: ScriptOptions = {},
): ScriptRule[] {
  const mode = options.mode ?? 'table'
  const body = text.replace(PLACEHOLDER, '')
  const problems: ScriptRule[] = []
  if (mode === 'table') {
    if (hasNoLetters(body)) return []
    // ja・zh・ko の、仮名・漢字・ハングルを含まない文（ON・4WD・{km} km・DAY {n}）は、英語の語が無ければ許す
    const borrowed = lang !== 'en' && !hasCjk(body) && !ENGLISH_WORD.test(body)
    if (!borrowed && !SCRIPT_OK.table[lang](body)) problems.push('script')
  } else if (!SCRIPT_OK.output[lang](body)) {
    problems.push('script')
  }
  if (lang === 'zh') {
    if (SIMPLIFIED.test(body)) problems.push('simplified')
    if (mode === 'table' && JAPANESE_FORM.test(body)) problems.push('japanese-form')
  }
  return problems
}
