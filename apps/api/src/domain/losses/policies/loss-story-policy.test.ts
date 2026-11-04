import { validateLossStory } from './loss-story-policy.js'

// docs/specs/loss/functional.md R5（UC-5b）

const ok = {
  ja: '鶴居のタンチョウは見られた。けれど阿寒の雪見の湯も、ウトロの流氷も、四人で見るはずの景色は次の機会に。',
  en: 'You saw the cranes in Tsurui, but the snowy hot spring and the drift ice will have to wait.',
  zh: '鶴居的丹頂鶴看到了，但阿寒的雪見溫泉與宇登呂的流冰，只能留待下次。',
  ko: '쓰루이의 두루미는 보았지만, 아칸의 설경 온천과 우토로의 유빙은 다음 기회로.',
}

const codes = (story: Record<string, string>) =>
  validateLossStory({ story: { ...ok, ...story } }).map((p) => `${p.code}@${p.path}`)

describe('validateLossStory', () => {
  it('UC-5b: 4 言語がそろった短い文は通る', () => {
    expect(validateLossStory({ story: ok })).toEqual([])
  })

  it('UC-5b: 空・400 字超・絵文字・3 桁以上の数・%・件・円・文字種の違いは外れる', () => {
    expect(codes({ ko: '' })).toEqual(['empty@story.ko'])
    expect(codes({ ja: 'あ'.repeat(401) })).toContain('too-long@story.ja')
    expect(codes({ en: 'Lost the trip 🦌' })).toContain('emoji@story.en')
    expect(codes({ ja: '北海道では年に 6,705 件の事故' })).toEqual(
      expect.arrayContaining(['number@story.ja', 'forbidden-symbol@story.ja']),
    )
    expect(codes({ zh: '損失 50%' })).toContain('forbidden-symbol@story.zh')
    expect(codes({ ja: '修理に六十万円' })).toContain('forbidden-symbol@story.ja')
    expect(codes({ ko: 'The trip ended here.' })).toContain('script@story.ko')
  })
})
