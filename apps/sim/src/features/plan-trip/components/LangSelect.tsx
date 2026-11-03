import { Lang } from '@antler/schema'
import { usePlanTripStore } from '../store'
import { PLAN_TEXT } from '../text'
import { htmlLang } from '../utils/lang'

/** 言語の名前は、その言語自身で書く（どの言語の画面からでも選べるように）。 */
const LANG_NAMES: Record<Lang, string> = {
  ja: '日本語',
  en: 'English',
  zh: '繁體中文',
  ko: '한국어',
}

function isLang(value: string): value is Lang {
  return Lang.safeParse(value).success
}

/** 言語切替（R6: ja / en / 繁體中文 / 한국어）。 */
export function LangSelect() {
  const lang = usePlanTripStore((s) => s.lang)
  const setLang = usePlanTripStore((s) => s.setLang)
  return (
    <div className="plan-lang">
      <label htmlFor="plan-lang">{PLAN_TEXT.lang[lang]}</label>
      <select
        id="plan-lang"
        className="plan-select"
        value={lang}
        onChange={(e) => {
          if (isLang(e.target.value)) setLang(e.target.value)
        }}
      >
        {Lang.options.map((l) => (
          <option key={l} value={l} lang={htmlLang(l)}>
            {LANG_NAMES[l]}
          </option>
        ))}
      </select>
    </div>
  )
}
