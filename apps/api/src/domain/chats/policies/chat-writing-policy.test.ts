import type { LocalizedText } from '../../trips/models/trip-writing.js'
import type { ChatWriting } from '../models/chat-deck.js'
import { validateChatWriting } from './chat-writing-policy.js'

// Claude の一言の検証（docs/specs/drive-audio-chat/functional.md R17、Test List WRITE-2a〜2c・2g）。

const OK: LocalizedText = {
  ja: '路面の条件がいいね、一緒に景色を楽しもう',
  en: 'The road looks great today, let us enjoy the view together',
  zh: '路況很好，一起欣賞風景吧',
  ko: '길이 좋네, 천천히 경치를 즐기자',
}
const plan = { lines: [{ id: 'l01' }, { id: 'l02' }] }
const writing = (over: Partial<LocalizedText> = {}, id2 = 'l02'): ChatWriting => ({
  lines: [
    { id: 'l01', text: OK },
    { id: id2, text: { ...OK, ...over } },
  ],
})
const codes = (w: ChatWriting) => validateChatWriting(w, plan).map((p) => `${p.code}@${p.path}`)

describe('validateChatWriting', () => {
  it('WRITE-2a: 正常な文（4 言語・id・数・順）→ 通る。「路面の条件がいい」「一緒に」「十分」「천천히」も通る', () => {
    expect(codes(writing())).toEqual([])
    expect(
      codes(
        writing({
          ja: '時間は十分あるから、千歳の空港まで寄り道しよう',
          zh: '時間十分充裕，我們一起看看十勝的雪',
          ko: '사이좋게 이만 가자, 시간은 충분해',
          en: 'Someone said this is one of the best roads in the north',
        }),
      ),
    ).toEqual([])
  })

  it('WRITE-2b: 行の数・id・順が違う → 外れ', () => {
    expect(codes({ lines: [{ id: 'l01', text: OK }] })).toContain('line-count@lines')
    expect(codes(writing({}, 'l03'))).toContain('line-order@lines.1')
    expect(
      codes({
        lines: [
          { id: 'l02', text: OK },
          { id: 'l01', text: OK },
        ],
      }),
    ).toEqual(['line-order@lines.0', 'line-order@lines.1'])
  })

  it('WRITE-2b: 1 言語が空・欠けている、上限を超える（ja・zh 50 / ko 60 / en 100 文字）→ 外れ', () => {
    expect(codes(writing({ ko: '  ' }))).toEqual(['empty@lines.1.ko'])
    const missing = writing()
    const line = missing.lines[1]
    if (line) line.text = { ja: OK.ja, en: OK.en, zh: OK.zh } as LocalizedText
    expect(codes(missing)).toEqual(['empty@lines.1.ko'])
    expect(codes(writing({ ja: 'あ'.repeat(50) }))).toEqual([])
    expect(codes(writing({ ja: 'あ'.repeat(51) }))).toEqual(['too-long@lines.1.ja'])
    expect(codes(writing({ zh: '好'.repeat(51) }))).toEqual(['too-long@lines.1.zh'])
    expect(codes(writing({ ko: '좋'.repeat(60) }))).toEqual([])
    expect(codes(writing({ ko: '좋'.repeat(61) }))).toEqual(['too-long@lines.1.ko'])
    // 英語は同じ内容でも長くなる（本物の Claude の 70〜90 文字の一言を通す）
    const en = 'The snow on the fields looks like a soft white blanket today, so pretty.'
    expect(codes(writing({ en }))).toEqual([])
    expect(codes(writing({ en: 'a'.repeat(101) }))).toEqual(['too-long@lines.1.en'])
  })

  it('WRITE-2c: 数字（半角・全角）・漢数字の連なり・英語の数詞・韓国語の数詞 → 外れ', () => {
    expect(codes(writing({ ja: '3回目の休憩だね' }))).toEqual(['digit@lines.1.ja'])
    expect(codes(writing({ ja: '６７０５件のうちのひとつ' }))).toContain('digit@lines.1.ja')
    expect(codes(writing({ en: 'About 6,705 of them' }))).toEqual(['digit@lines.1.en'])
    expect(codes(writing({ ja: '六千もあるらしい' }))).toEqual(['number-word@lines.1.ja'])
    expect(codes(writing({ zh: '一萬個人來過' }))).toEqual(['number-word@lines.1.zh'])
    expect(codes(writing({ en: 'Six thousand of them every year' }))).toEqual([
      'number-word@lines.1.en',
    ])
    expect(codes(writing({ en: 'Nearly forty percent of the time' }))).toEqual([
      'number-word@lines.1.en',
    ])
    expect(codes(writing({ ko: '육천 번이나 있었대' }))).toEqual(['number-word@lines.1.ko'])
    expect(codes(writing({ ko: '삼만 명이 왔대' }))).toEqual(['number-word@lines.1.ko'])
  })

  it('WRITE-2c: % ¥ $・絵文字 → 外れ。「件」「円」だけでは外さない（「条件」「円滑」）', () => {
    expect(codes(writing({ ja: 'ほぼ全部％だね' }))).toEqual(['forbidden-symbol@lines.1.ja'])
    expect(codes(writing({ en: 'That costs $ a lot' }))).toEqual(['forbidden-symbol@lines.1.en'])
    expect(codes(writing({ zh: '要花很多￥' }))).toEqual(['forbidden-symbol@lines.1.zh'])
    expect(codes(writing({ ko: '좋다 \u{1F600}' }))).toEqual(['emoji@lines.1.ko'])
    expect(codes(writing({ ja: '条件がよくて運転が円滑だ' }))).toEqual([])
  })

  it('WRITE-2c: 言語ごとの文字種が違う・zh に簡体字 → 外れ', () => {
    expect(codes(writing({ ko: 'Nice road' }))).toEqual(['script@lines.1.ko'])
    expect(codes(writing({ ja: 'Nice road' }))).toEqual(['script@lines.1.ja'])
    expect(codes(writing({ en: '景色がいい' }))).toEqual(['script@lines.1.en'])
    expect(codes(writing({ zh: 'きれいな景色' }))).toEqual(['script@lines.1.zh'])
    expect(codes(writing({ zh: '我们一起看风景' }))).toEqual(['simplified@lines.1.zh'])
    expect(codes(writing({ zh: '這輛車開起來很舒服' }))).toEqual([])
  })

  it('WRITE-2g: 鹿の語（鹿・シカ・deer・사슴）・「前方に鹿」「DEER AHEAD」→ 外れ。助詞の「しか」は通る', () => {
    expect(codes(writing({ ja: '前方に鹿' }))).toEqual(['deer-word@lines.1.ja'])
    expect(codes(writing({ ja: 'シカがいそうな森だね' }))).toEqual(['deer-word@lines.1.ja'])
    expect(codes(writing({ en: 'DEER AHEAD' }))).toEqual(['deer-word@lines.1.en'])
    expect(codes(writing({ zh: '小心有鹿' }))).toEqual(['deer-word@lines.1.zh'])
    expect(codes(writing({ ko: '사슴이 보여' }))).toEqual(['deer-word@lines.1.ko'])
    expect(codes(writing({ ja: '今日しか見られない景色だね' }))).toEqual([])
  })

  it('WRITE-2c・WRITE-2g: 全角・半角カナ・丸数字・見えない文字ですり抜けない。zh は漢字が要る（security-auditor W3）', () => {
    expect(codes(writing({ en: 'ｄｅｅｒ crossing' }))).toEqual(['deer-word@lines.1.en'])
    expect(codes(writing({ ja: 'ｼｶの森だね' }))).toEqual(['deer-word@lines.1.ja'])
    expect(codes(writing({ ja: '休憩は②回目だね' }))).toEqual(['digit@lines.1.ja'])
    expect(codes(writing({ ja: 'いい​景色だね' }))).toEqual(['invisible@lines.1.ja'])
    expect(codes(writing({ zh: 'What a nice view' }))).toEqual(['script@lines.1.zh'])
  })
})
