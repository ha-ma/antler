import { DROP_TILTS, dropSequence } from './drop'

describe('dropSequence（result-screens R2）', () => {
  it('DROP-1 呼ぶたびに 0, 1, 2 … の番号と、決まった表の傾きを返す', () => {
    const next = dropSequence()
    const styles = [next(), next(), next()]
    expect(styles.map((s) => s['--loss-drop-i'])).toEqual([0, 1, 2])
    expect(styles.map((s) => s['--loss-tilt'])).toEqual(
      DROP_TILTS.slice(0, 3).map((t) => `${String(t)}deg`),
    )
  })

  it('DROP-1 明示した傾きはそれを使い、番号は続く', () => {
    const next = dropSequence()
    next()
    expect(next(-1.5)).toEqual({ '--loss-drop-i': 1, '--loss-tilt': '-1.5deg' })
  })

  it('DROP-1 表は 1° 以内（わずかに傾く）で、作り直すと同じ並びになる（乱数なし）', () => {
    expect(DROP_TILTS.every((t) => Math.abs(t) <= 1)).toBe(true)
    const a = dropSequence()
    const b = dropSequence()
    const seq = (f: typeof a) => Array.from({ length: 12 }, () => f()['--loss-tilt'])
    expect(seq(a)).toEqual(seq(b))
  })
})
