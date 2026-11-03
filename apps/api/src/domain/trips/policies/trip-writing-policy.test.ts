import { validWriting } from '../../../../tests/factories/trips.js'
import type { TripWriting } from '../models/trip-writing.js'
import { validateTripWriting } from './trip-writing-policy.js'

const days = [{ day: 1 }, { day: 2 }, { day: 3 }]
const dayNumbers = [1, 2, 3]

function noteOf(w: TripWriting, i: number) {
  const entry = w.dayNotes[i]
  if (!entry) throw new Error(`dayNotes[${String(i)}] が無い`)
  return entry.note
}

function codes(writing: TripWriting, numbers: number[] = dayNumbers) {
  return validateTripWriting(writing, numbers).map((p) => `${p.code}@${p.path}`)
}

describe('validateTripWriting（R5 出力の検証）', () => {
  it('UC-5a: 4 言語がそろい、dayNotes の数と順が日数と同じなら問題なし', () => {
    expect(codes(validWriting({ days }))).toEqual([])
  })

  it('UC-5b: 1 言語だけ空（空白だけも）→ empty', () => {
    const w = validWriting({ days })
    w.titles.ko = '  '
    expect(codes(w)).toEqual(['empty@titles.ko'])
  })

  it('UC-5b: 言語が欠けている → empty', () => {
    const w = validWriting({ days })
    const note: Partial<TripWriting['dayNotes'][number]['note']> = { ...w.dayNotes[0]?.note }
    delete note.zh
    w.dayNotes[0] = { day: 1, note: note as TripWriting['dayNotes'][number]['note'] }
    expect(codes(w)).toEqual(['empty@dayNotes.0.zh'])
  })

  it('UC-5: 説明が 1 日ぶん足りない → day-count', () => {
    const w = validWriting({ days: days.slice(0, 2) })
    expect(codes(w)).toEqual(['day-count@dayNotes'])
  })

  it('UC-5: 日の順が違う → day-order', () => {
    const w = validWriting({ days: [{ day: 2 }, { day: 1 }, { day: 3 }] })
    expect(codes(w)).toEqual(['day-order@dayNotes.0', 'day-order@dayNotes.1'])
  })

  it('UC-5c: 3 桁以上の数（桁区切り・全角も）→ number', () => {
    for (const text of ['昨年は 123 頭', '1,234 頭', '年に１２３頭', 'the year 2027']) {
      const w = validWriting({ days })
      w.titles.en = text
      expect(codes(w)).toContain('number@titles.en')
    }
    const ok = validWriting({ days })
    ok.titles.ja = '2月14日から 5 日間'
    expect(codes(ok)).toEqual([])
  })

  it('UC-5c: %・％・件・円 → forbidden-symbol', () => {
    for (const text of ['半分 50%', '５０％', '事故が 12 件', '予算 12 万円']) {
      const w = validWriting({ days })
      w.dayNotes[1] = { day: 2, note: { ...noteOf(w, 1), ja: text } }
      expect(codes(w)).toContain('forbidden-symbol@dayNotes.1.ja')
    }
  })

  it('UC-5c: 絵文字 → emoji', () => {
    const w = validWriting({ days })
    w.titles.zh = '道東之旅 \u{1F98C}'
    expect(codes(w)).toEqual(['emoji@titles.zh'])
  })

  it('タイトルは 200 字まで、説明は 400 字まで', () => {
    const w = validWriting({ days })
    w.titles.ja = 'あ'.repeat(200)
    expect(codes(w)).toEqual([])
    w.titles.ja = 'あ'.repeat(201)
    w.dayNotes[2] = { day: 3, note: { ...noteOf(w, 2), en: 'a'.repeat(401) } }
    expect(codes(w)).toEqual(['too-long@titles.ja', 'too-long@dayNotes.2.en'])
  })
})
