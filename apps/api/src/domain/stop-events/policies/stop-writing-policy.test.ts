import type { StopDeck } from '../models/stop-deck.js'
import type { StopWriting } from '../models/stop-writing.js'
import { validateStopWriting } from './stop-writing-policy.js'

// WRITE-2a〜c（docs/specs/stop-events/functional.md R7）。

const L = (ja: string, en: string, zh: string, ko: string) => ({ ja, en, zh, ko })

const deckShape: Pick<StopDeck, 'scenes'> = {
  scenes: [
    { id: 'p-red-crowned-crane', choices: [{ id: 'leave' }, { id: 'linger' }] },
    { id: 'r1-fuel', choices: [{ id: 'refuel' }, { id: 'skip' }] },
  ] as unknown as StopDeck['scenes'],
}

function writing(): StopWriting {
  const choice = (id: string) => ({
    id,
    label: L('いま出発する', 'Leave now', '現在出發', '지금 출발한다'),
    note: L('まもなく着く', 'Arrive within the hour', '一小時內抵達', '한 시간 안에 도착'),
  })
  return {
    scenes: [
      {
        id: 'p-red-crowned-crane',
        headline: L(
          '群れがまだ残っていた',
          'The flock was still there',
          '鶴群還在',
          '무리가 아직 남아 있었다',
        ),
        body: L(
          '給餌場には四十羽ほど。',
          'About forty cranes at the feeding ground.',
          '餵食場約有四十隻。',
          '먹이터에는 사십 마리 정도.',
        ),
        choices: [choice('leave'), choice('linger')],
      },
      {
        id: 'r1-fuel',
        headline: L(
          '燃料が半分を切った',
          'The tank is under half',
          '油量不到一半',
          '연료가 절반 아래',
        ),
        body: L(
          'この先は給油所が少ない。',
          'Few stations ahead.',
          '前方加油站很少。',
          '앞으로 주유소가 적다.',
        ),
        choices: [choice('refuel'), choice('skip')],
      },
    ],
  }
}

const codes = (w: StopWriting) =>
  validateStopWriting(w, deckShape).map((p) => `${p.code}@${p.path}`)

describe('validateStopWriting（R7）', () => {
  it('WRITE-2a: 4 言語がそろい、場面と選択肢の id・数・順が束と同じなら問題なし', () => {
    expect(codes(writing())).toEqual([])
  })

  it('WRITE-2b: 場面が足りない・順が違う → scene-count / scene-order', () => {
    const w = writing()
    expect(codes({ scenes: w.scenes.slice(0, 1) })).toEqual(['scene-count@scenes'])
    const swapped = writing()
    swapped.scenes.reverse()
    expect(codes(swapped)).toEqual(
      expect.arrayContaining(['scene-order@scenes.0', 'scene-order@scenes.1']),
    )
  })

  it('WRITE-2b: 選択肢が足りない・id が違う → choice-count / choice-order', () => {
    const w = writing()
    w.scenes[0]?.choices.pop()
    expect(codes(w)).toEqual(['choice-count@scenes.0.choices'])
    const renamed = writing()
    const first = renamed.scenes[1]?.choices[0]
    if (first) first.id = 'wait'
    expect(codes(renamed)).toEqual(['choice-order@scenes.1.choices.0'])
  })

  it('WRITE-2b: 1 言語が空 → empty', () => {
    const w = writing()
    const s = w.scenes[0]
    if (s) s.body.ko = ' '
    expect(codes(w)).toEqual(['empty@scenes.0.body.ko'])
  })

  it('WRITE-2c: 3 桁以上の数・%・件・円・¥・$・絵文字 → 外れ', () => {
    const cases: [string, string][] = [
      ['年間6,705頭', 'number'],
      ['確率は高い%', 'forbidden-symbol'],
      ['事故が多い件', 'forbidden-symbol'],
      ['損害は高い円', 'forbidden-symbol'],
      ['¥がかかる', 'forbidden-symbol'],
      ['$がかかる', 'forbidden-symbol'],
      ['鶴がいた🦢', 'emoji'],
    ]
    for (const [text, code] of cases) {
      const w = writing()
      const s = w.scenes[0]
      if (s) s.headline.ja = text
      expect(codes(w)).toContain(`${code}@scenes.0.headline.ja`)
    }
  })

  it('WRITE-2c: zh・ko の金額（兩萬元・2만 원）は外れ、「元気」「원하다」「엔진」は通る', () => {
    const set = (lang: 'ja' | 'zh' | 'ko', text: string) => {
      const w = writing()
      const s = w.scenes[0]
      if (s) s.body[lang] = text
      return codes(w)
    }
    expect(set('zh', '大約花了兩萬元。')).toContain('forbidden-symbol@scenes.0.body.zh')
    expect(set('ko', '2만 원 정도 들었다.')).toContain('forbidden-symbol@scenes.0.body.ko')
    expect(set('ja', '同乗者はまだ元気だ。')).toEqual([])
    expect(set('ko', '친구가 더 있기를 원했다. 엔진은 따뜻하다.')).toEqual([])
  })

  it('WRITE-2c: 時刻（16:20・16時・四時・4點・4시）は外れ、見出し・短文の「1時間」は通る', () => {
    const body = (lang: 'ja' | 'en' | 'zh' | 'ko', text: string) => {
      const w = writing()
      const s = w.scenes[0]
      if (s) s.body[lang] = text
      return codes(w)
    }
    for (const text of [
      '16:20に出る。',
      '１６：２０に出る。',
      '16時に出る。',
      '四時には着く。',
      '午後4時に出る。',
    ]) {
      expect(body('ja', text)).toContain('clock-time@scenes.0.body.ja')
    }
    expect(body('zh', '下午4點出發。')).toContain('clock-time@scenes.0.body.zh')
    expect(body('ko', '4시에 출발한다.')).toContain('clock-time@scenes.0.body.ko')
    expect(body('en', 'Leave at 4:20 pm.')).toContain('clock-time@scenes.0.body.en')
    expect(body('ja', 'あと1時間、鶴を見ていた。')).toEqual([])
    // 「一時的」「一時停止」「有一點」は時刻ではない
    expect(body('ja', '雪は一時的に強くなった。一時停止して確かめた。')).toEqual([])
    expect(body('zh', '雪下得有一點大。')).toEqual([])
    expect(body('ko', '한 시간 더 있었다. 2시간이면 충분하다.')).toEqual([])
  })

  it('WRITE-2c: 言い回し・一言は数字を含めば外れ（画面の計算値と食い違わせない）', () => {
    const w = writing()
    const c = w.scenes[0]?.choices[1]
    if (c) {
      c.label.ja = 'もう1時間いる'
      c.note.zh = '晚40分鐘'
    }
    expect(codes(w)).toEqual([
      'digit@scenes.0.choices.1.label.ja',
      'digit@scenes.0.choices.1.note.zh',
    ])
  })

  it('WRITE-2c: 長すぎる見出し → too-long、言語の取り違え → script', () => {
    const w = writing()
    const s = w.scenes[0]
    if (s) {
      s.headline.en = 'a'.repeat(121)
      s.headline.ko = '群れがいた'
    }
    expect(codes(w)).toEqual(['too-long@scenes.0.headline.en', 'script@scenes.0.headline.ko'])
  })
})
