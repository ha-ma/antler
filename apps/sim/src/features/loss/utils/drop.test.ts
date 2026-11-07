import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DROP_DURATION_MS, DROP_STAGGER_MS, DROP_TILTS, dropLandedMs, dropSequence } from './drop'

// 落ちて積み重なる並び（result-screens R2）と、数え上げの始まり（result-countup R5）

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

describe('dropLandedMs（result-countup R5）', () => {
  // vitest は CSS を空にして読むので、ファイルを直に読む
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../components/loss.css'),
    'utf8',
  )

  it('LOSS-2 着地の時刻は 番号 × 150 ms ＋ 820 ms で、loss.css の値と同じ', () => {
    expect(css).toContain(`--loss-drop-duration: ${String(DROP_DURATION_MS)}ms;`)
    expect(css).toContain(`--loss-drop-stagger: ${String(DROP_STAGGER_MS)}ms;`)
    const next = dropSequence()
    expect([next(), next(), next()].map(dropLandedMs)).toEqual([820, 970, 1120])
    expect(dropLandedMs(undefined)).toBe(0)
  })
})
