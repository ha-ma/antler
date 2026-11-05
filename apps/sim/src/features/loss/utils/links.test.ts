import { factSentence, monthLabel } from './format'
import { replayHref, retryHref } from './links'

// UC-7b（R9）の導線と、UC-5e（画面側）の事実の 1 文。

const c = { tripId: 'K7m2abcd', day: 2, alertEnabled: false, simMs: 812345 }

describe('A6-4 の導線', () => {
  it('UC-7b: 主ボタンは /trip/:id/brief?day=n（alert のクエリ無し）', () => {
    expect(retryHref(c)).toBe('/trip/K7m2abcd/brief?day=2')
  })

  it('UC-7b: 副は /drive?trip&day&alert=off&replay=simMs−3000（OFF の衝突）', () => {
    expect(replayHref(c)).toBe('/drive?trip=K7m2abcd&day=2&alert=off&replay=809345')
  })

  it('UC-7b: ON の衝突は alert 無し、simMs が 3000 未満なら replay=0', () => {
    expect(replayHref({ ...c, alertEnabled: true, simMs: 2999 })).toBe(
      '/drive?trip=K7m2abcd&day=2&replay=0',
    )
  })
})

describe('factSentence', () => {
  const f = { light: 'dusk' as const, side: 'L' as const, speedKmh: 54 }

  it('UC-5e: OFF の衝突は「OFF でした」と「もう走れません」', () => {
    expect(factSentence({ ...f, alertEnabled: false }, 'ja')).toBe(
      '薄暮、左から出てきた鹿と、時速 54 km で衝突しました。鹿アラートは OFF でした。車はもう走れません。',
    )
  })

  it('UC-5e: ON の衝突は「OFF でした」が無い', () => {
    const s = factSentence({ ...f, side: 'R', alertEnabled: true }, 'en')
    expect(s).toBe(
      'At twilight, a deer came out from the right and the car hit it at 54 km/h. The car can no longer be driven.',
    )
    expect(s).not.toContain('OFF')
  })
})

describe('monthLabel', () => {
  it('年月を言語ごとに出す', () => {
    expect(monthLabel('2024-10', 'ja')).toBe('2024年10月')
    expect(monthLabel('2024-03', 'en')).toBe('3/2024')
  })
})
