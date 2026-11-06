import { validStory } from '../../../../tests/factories/losses.js'
import { validChatWriting } from '../../../../tests/factories/chats.js'
import { validStopWriting } from '../../../../tests/factories/stop-events.js'
import { validWriting } from '../../../../tests/factories/trips.js'
import { validateChatWriting } from '../../chats/policies/chat-writing-policy.js'
import { validateLossStory } from '../../losses/policies/loss-story-policy.js'
import { validateStopWriting } from '../../stop-events/policies/stop-writing-policy.js'
import { TRIP_LANGS, type TripLang } from '../../trips/models/trip-writing.js'
import { validateTripWriting } from '../../trips/policies/trip-writing-policy.js'
import { langScriptProblems } from './lang-script-policy.js'

// docs/specs/i18n/functional.md R8（GEN-1・GEN-2）

describe('GEN-1: Claude の出力の文字種（4 つの口で共通）', () => {
  it('正しい 4 言語の文は通る', () => {
    expect(langScriptProblems('ja', '雪原を走る日')).toEqual([])
    expect(langScriptProblems('en', 'Snowy roads')).toEqual([])
    expect(langScriptProblems('zh', '雪原之路')).toEqual([])
    expect(langScriptProblems('ko', '눈길 드라이브')).toEqual([])
  })

  it('zh の簡体字・仮名、ko の仮名、en の仮名で外れる', () => {
    expect(langScriptProblems('zh', '开车去看雪')).toEqual(['simplified'])
    expect(langScriptProblems('zh', '雪のみち')).toEqual(['script'])
    expect(langScriptProblems('zh', 'Snow road')).toEqual(['script'])
    expect(langScriptProblems('ko', '눈길 ドライブ')).toEqual(['script'])
    expect(langScriptProblems('en', 'Snowy みち')).toEqual(['script'])
    expect(langScriptProblems('ja', '눈길')).toEqual(['script'])
  })

  it('en の漢字の地名の併記（標識と同じ）は通る', () => {
    expect(langScriptProblems('en', 'Lake Mashu (摩周湖) at dawn')).toEqual([])
  })
})

/** 出力の中の 4 言語の組の道筋を全部集める */
function localizedPaths(value: unknown, path = ''): string[] {
  if (typeof value !== 'object' || value === null) return []
  const record = value as Record<string, unknown>
  if (TRIP_LANGS.every((lang) => typeof record[lang] === 'string')) return [path]
  return Object.entries(record).flatMap(([k, v]) => localizedPaths(v, path ? `${path}.${k}` : k))
}

function setAt(value: unknown, path: string, lang: TripLang, text: string): void {
  let node = value as Record<string, unknown>
  for (const key of path.split('.').filter(Boolean)) node = node[key] as Record<string, unknown>
  node[lang] = text
}

/** その言語に合わない文（仮名を含めば ja 以外で外れ、ハングルだけなら ja で外れる） */
const WRONG: Record<TripLang, string> = {
  ja: '눈길 드라이브',
  en: 'ゆきみち',
  zh: 'ゆきみち',
  ko: 'ゆきみち',
}

type Mouth = {
  name: string
  make: () => unknown
  validate: (output: never) => { code: string; path: string }[]
}

const MOUTHS: Mouth[] = [
  {
    name: 'しおり（trip-writing）',
    make: () => validWriting({ days: [{ day: 1 }, { day: 2 }] }),
    validate: (w) => validateTripWriting(w, [1, 2]),
  },
  {
    name: '出来事の場面（stop-writing）',
    make: () => validStopWriting({ scenes: DECK.scenes } as never),
    validate: (w) => validateStopWriting(w, DECK as never),
  },
  { name: '喪失文（loss-story）', make: () => validStory(), validate: (w) => validateLossStory(w) },
  {
    name: '車内の会話（chat-writing）',
    make: () => validChatWriting({ lines: [{ id: 'l1' }, { id: 'l2' }] } as never),
    validate: (w) => validateChatWriting(w, { lines: [{ id: 'l1' }, { id: 'l2' }] }),
  },
]

const DECK = {
  scenes: [
    { id: 's1', choices: [{ id: 'c1' }, { id: 'c2' }] },
    { id: 's2', choices: [{ id: 'c3' }] },
  ],
}

describe('GEN-2: 4 つの口のすべての文の欄が 4 言語の検査を通る', () => {
  it.each(MOUTHS)('$name: fixture は通り、どの欄・どの言語を崩しても script で外れる', (mouth) => {
    expect(mouth.validate(mouth.make() as never)).toEqual([])
    const paths = localizedPaths(mouth.make())
    expect(paths.length).toBeGreaterThan(0)
    for (const path of paths) {
      for (const lang of TRIP_LANGS) {
        const output = mouth.make()
        setAt(output, path, lang, WRONG[lang])
        const problems = mouth.validate(output as never)
        expect(
          problems.some((p) => p.code === 'script'),
          `${mouth.name} ${path}.${lang}`,
        ).toBe(true)
      }
    }
  })
})
