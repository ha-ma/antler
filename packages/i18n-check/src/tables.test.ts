import { describe, expect, it } from 'vitest'
import { JAPANESE_FORM_CHARS, SIMPLIFIED_CHARS, scriptProblems } from './script'
import { checkEntry, checkTables, collectEntries } from './tables'

const ok = { ja: '出発', en: 'Depart', zh: '出發', ko: '출발' }

function rules(texts: Record<string, string>) {
  return checkEntry({ path: 'x', texts }).map((p) => `${p.rule}:${p.lang ?? ''}`)
}

describe('I18N-1: 言語の欠け・空', () => {
  it('4 言語がそろえば問題なし', () => {
    expect(rules(ok)).toEqual([])
  })

  it('言語が無い・空・空白だけ', () => {
    const entries = collectEntries({ a: { ja: '出発', en: 'Depart', zh: '', ko: '  ' } })
    expect(entries).toHaveLength(1)
    expect(checkEntry(entries[0]!).map((p) => `${p.rule}:${p.lang ?? ''}`)).toEqual([
      'empty:zh',
      'empty:ko',
    ])
    // 言語が外側の表で、ある言語にだけ道筋が無い
    const outer = collectEntries({
      ja: { a: '出発' },
      en: { a: 'Depart' },
      zh: {},
      ko: { a: '출발' },
    })
    expect(checkEntry(outer[0]!).map((p) => `${p.rule}:${p.lang ?? ''}`)).toEqual(['missing:zh'])
  })

  it('2 言語だけの組も組として見て、足りない言語を missing にする', () => {
    const result = checkTables({ 't.ts': { T: { a: { ja: '出発', en: 'Depart' } } } })
    expect(result.problems.map((p) => `${p.path}:${p.rule}:${p.lang ?? ''}`)).toEqual([
      'T.a:missing:zh',
      'T.a:missing:ko',
    ])
  })

  it('見えない文字だけの文は empty', () => {
    expect(rules({ ...ok, ko: '​' })).toEqual(['empty:ko'])
    const zw = '​​'
    expect(rules({ ja: zw, en: zw, zh: zw, ko: zw })).toHaveLength(4)
  })
})

describe('I18N-2: 表の形', () => {
  it('言語が外側の表は、同じ道筋の葉を組にする。関数は辿らない', () => {
    const table = {
      ja: { title: 'タイトル', nested: { a: 'あ' }, fn: () => 'x' },
      en: { title: 'Title', nested: { a: 'A' }, fn: () => 'x' },
      zh: { title: '標題', nested: { a: '甲' }, fn: () => 'x' },
      ko: { title: '제목', nested: { a: '가' }, fn: () => 'x' },
    }
    const entries = collectEntries({ TABLE: table })
    expect(entries.map((e) => e.path).sort()).toEqual(['TABLE.nested.a', 'TABLE.title'])
  })

  it('表の中の関数は unsampled で返す（見本を出して例外にする）。一番上の export の関数は道具なので数えない', () => {
    const mod = {
      helper: () => 'x',
      LINES: [(n: string) => ({ ja: n, en: n, zh: n, ko: n })],
      T: {
        ja: { say: () => 'あ' },
        en: { say: () => 'A' },
        zh: { say: () => '甲' },
        ko: { say: () => '가' },
      },
    }
    const result = checkTables({ 'chat-text.ts': mod })
    expect(result.problems.map((p) => `${p.path}:${p.rule}`)).toEqual([
      'LINES.0:unsampled',
      'T.say:unsampled',
    ])
    const allowed = checkTables(
      { 'chat-text.ts': mod },
      {
        allow: [
          { path: 'chat-text.ts:LINES.0', rule: 'unsampled', reason: '見本を出した' },
          { path: 'chat-text.ts:T.say', rule: 'unsampled', reason: '見本を出した' },
        ],
      },
    )
    expect(allowed.problems).toEqual([])
  })

  it('配列の中の組と、組の横に並ぶキーも辿る', () => {
    const entries = collectEntries({
      list: [{ id: 'a', name: ok, extra: { ja: 'あ', en: 'A', zh: '甲', ko: '가' } }],
      item: { ...ok, sub: { ...ok } },
    })
    expect(entries.map((e) => e.path).sort()).toEqual([
      'item',
      'item.sub',
      'list.0.extra',
      'list.0.name',
    ])
  })

  it('同じオブジェクトを 2 回見ない（循環しても止まる）', () => {
    const a: Record<string, unknown> = { name: ok }
    a['self'] = a
    expect(collectEntries(a)).toHaveLength(1)
  })
})

describe('I18N-3: 文字種', () => {
  it('ja に仮名か漢字・en に CJK なし・zh に仮名とハングルなし・ko にハングル', () => {
    expect(rules({ ...ok, ja: 'Depart!' })).toContain('script:ja')
    expect(rules({ ...ok, en: 'Depart 出発' })).toContain('script:en')
    expect(rules({ ...ok, zh: 'しゅっぱつ' })).toContain('script:zh')
    expect(rules({ ...ok, zh: '출발' })).toContain('script:zh')
    expect(rules({ ...ok, ko: '出發' })).toContain('script:ko')
    expect(rules({ ...ok, ko: '출발 しゅっぱつ' })).toContain('script:ko')
  })

  it('ko の漢字語・zh と ja が同じ漢字の語は許す', () => {
    expect(rules({ ...ok, ko: '출발（出發）' })).toEqual([])
    expect(rules({ ja: '道東', en: 'East Hokkaido', zh: '道東', ko: '도동' })).toEqual([])
  })

  it('数字・記号だけの文と、中立の文には当てない', () => {
    expect(
      rules({ ja: '{n} / {of}', en: '{n} / {of}', zh: '{n} / {of}', ko: '{n} / {of}' }),
    ).toEqual([])
    expect(rules({ ja: 'EZO ROAD', en: 'EZO ROAD', zh: 'EZO ROAD', ko: 'EZO ROAD' })).toEqual([])
    expect(rules({ ja: 'km/h', en: 'km/h', zh: 'km/h', ko: 'km/h' })).toEqual([])
  })

  it('4 言語が同じでも仮名・漢字を含めば中立ではない（ja の写し）', () => {
    const copied = rules({ ja: '出発', en: '出発', zh: '出発', ko: '出発' })
    expect(copied).toEqual(
      expect.arrayContaining(['script:en', 'script:ko', 'japanese-form:zh', 'copy:en', 'copy:ko']),
    )
  })
})

describe('I18N-3b: 略語・単位と 1 言語だけの文', () => {
  it('ja・zh・ko の略語・単位（英語の語が無い）は許す。英語の語は落とす', () => {
    expect(rules({ ja: 'ON', en: 'ON', zh: '開', ko: '켜짐' })).toEqual([])
    expect(rules({ ja: '4WD', en: '4WD', zh: '四輪驅動', ko: '4WD' })).toEqual([])
    expect(rules({ ja: '{km} km', en: '{km} km', zh: '{km} 公里', ko: '{km}km' })).toEqual([])
    expect(rules({ ...ok, ko: 'Depart' })).toContain('script:ko')
    expect(rules({ ...ok, zh: 'Radio' })).toContain('script:zh')
  })

  it('4 言語に同じ英文を写した組は中立にならない', () => {
    const copied = rules({ ja: 'Loading', en: 'Loading', zh: 'Loading', ko: 'Loading' })
    expect(copied).toEqual(['script:ja', 'script:zh', 'script:ko'])
  })

  it('言語が外側の表で、配列の長さが違えば missing', () => {
    const entries = collectEntries({
      ja: { c: ['あ', 'い'] },
      en: { c: ['A'] },
      zh: { c: ['甲', '乙'] },
      ko: { c: ['가', '나'] },
    })
    const missing = entries.flatMap((e) =>
      checkEntry(e).map((p) => `${e.path}:${p.rule}:${p.lang}`),
    )
    expect(missing).toEqual(['c.1:missing:en'])
  })

  it('4 言語の組の外の仮名・漢字・ハングルの文を untranslated で返す', () => {
    const result = checkTables({
      'hud-text.ts': { HUD: { title: '国道 240 号', unit: 'km/h', ok: { ...ok } } },
    })
    expect(result.problems.map((p) => `${p.path}:${p.rule}`)).toEqual(['HUD.title:untranslated'])
  })
})

describe('I18N-4: zh の簡体字と日本の新字体', () => {
  it('簡体字は simplified、新字体は japanese-form', () => {
    expect(rules({ ...ok, zh: '开车' })).toContain('simplified:zh')
    expect(rules({ ...ok, zh: '出発' })).toContain('japanese-form:zh')
    expect(rules({ ...ok, zh: '園内' })).toContain('japanese-form:zh')
    expect(rules({ ...ok, zh: '園內' })).toEqual([])
    // この製品の語（国道・観光・関・画面）の字（code-reviewer W1）
    expect(rules({ ...ok, zh: '国道 240 號' })).toContain('simplified:zh')
    expect(rules({ ...ok, zh: '観光' })).toContain('japanese-form:zh')
    expect(rules({ ...ok, zh: '國道 240 號・觀光' })).toEqual([])
  })

  it('出力の規則（mode: output）は新字体を見ず、en の漢字の地名を許す。en の仮名は落とす', () => {
    const out = { mode: 'output' } as const
    expect(scriptProblems('zh', '出発', out)).toEqual([])
    expect(scriptProblems('zh', '开车', out)).toEqual(['simplified'])
    expect(scriptProblems('en', 'Lake Mashu (摩周湖)', out)).toEqual([])
    expect(scriptProblems('en', 'Lake Mashu (摩周湖)')).toEqual(['script'])
    expect(scriptProblems('en', 'Lake ましゅう', out)).toEqual(['script'])
    expect(scriptProblems('ja', '123', out)).toEqual(['script'])
  })

  it('簡体字と新字体の一覧に同じ字が無い', () => {
    const both = [...SIMPLIFIED_CHARS].filter((c) => JAPANESE_FORM_CHARS.includes(c))
    expect(both).toEqual([])
  })
})

describe('I18N-5: ja の写し', () => {
  it('en・ko が ja と同じ文', () => {
    expect(rules({ ...ok, en: '出発' })).toContain('copy:en')
    expect(rules({ ...ok, ko: '出発' })).toContain('copy:ko')
  })

  it('zh が ja と同じ漢字の文（地名など）は copy にしない。新字体なら japanese-form で落ちる', () => {
    expect(rules({ ja: '阿寒湖', en: 'Lake Akan', zh: '阿寒湖', ko: '아칸호' })).toEqual([])
    expect(rules({ ja: '距離', en: 'Distance', zh: '距離', ko: '거리' })).toEqual([])
    expect(
      rules({ ja: '鶴居村役場', en: 'Village office', zh: '鶴居村役場', ko: '촌사무소' }),
    ).toEqual([])
    expect(
      rules({ ja: '旭川駅', en: 'Asahikawa Station', zh: '旭川駅', ko: '아사히카와역' }),
    ).toContain('japanese-form:zh')
  })
})

describe('I18N-6: 差し込みの名前', () => {
  it('{name} の集まりが 4 言語でそろわない', () => {
    const t = { ja: '約 {n} 時間', en: 'About {n} h', zh: '約 {n} 小時', ko: '약 {m}시간' }
    expect(rules(t)).toEqual(['placeholder:ko'])
  })
})

describe('I18N-7: 例外', () => {
  const tables = { 'a/text.ts': { T: { x: { ...ok, en: '出発' } } } }

  it('道筋・規則・理由つきの例外だけ許す', () => {
    const result = checkTables(tables, {
      allow: [{ path: 'a/text.ts:T.x', rule: 'copy', reason: 'テスト' }],
    })
    expect(result.problems.map((p) => p.rule)).toEqual(['script'])
    expect(result.unusedAllowances).toEqual([])
  })

  it('使われない例外を返す', () => {
    const result = checkTables(tables, {
      allow: [{ path: 'T.y', rule: 'copy', reason: '古い' }],
    })
    expect(result.unusedAllowances).toHaveLength(1)
    expect(result.entries).toBe(1)
  })
})
