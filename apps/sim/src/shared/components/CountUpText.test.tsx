import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen } from '@testing-library/react'
import { stubCountUpEnv } from '@/test/count-up'
import { CountUpText } from './CountUpText'

// 数え上げる数字（docs/specs/result-countup/functional.md R3〜R6、COUNT-1〜COUNT-6）

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'count-up.css'), 'utf8')

const MONEY = '¥615,000（約 $4,100）'

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderInList(text: string, props: { hold?: number[]; notBeforeMs?: number } = {}) {
  return render(
    <p data-testid="sentence">
      平均 <CountUpText text={text} {...props} />。
    </p>,
  )
}

const frameOf = (container: HTMLElement) =>
  container.querySelector('.count-up__frame')?.textContent ?? null

describe('CountUpText', () => {
  it('COUNT-1: IntersectionObserver が無いと、最初からふつうの文字で最後の値（rAF はある）', () => {
    expect(typeof window.requestAnimationFrame).toBe('function')
    expect('IntersectionObserver' in window).toBe(false)
    const { container } = renderInList(MONEY)
    expect(screen.getByTestId('sentence').textContent).toBe(`平均 ${MONEY}。`)
    expect(container.querySelector('[aria-hidden]')).toBeNull()
    expect(container.querySelector('.count-up')?.childNodes).toHaveLength(1)
  })

  it('COUNT-2: 動きを減らす設定では、最初からふつうの文字で最後の値', () => {
    stubCountUpEnv({ reducedMotion: true })
    const { container } = renderInList(MONEY)
    expect(screen.getByTestId('sentence').textContent).toBe(`平均 ${MONEY}。`)
    expect(container.querySelector('[aria-hidden]')).toBeNull()
  })

  it('COUNT-3: 動いているあいだ、見える数字は aria-hidden、読み上げの文字は最後の値', () => {
    const env = stubCountUpEnv()
    const { container } = render(
      <section aria-labelledby="h">
        <h2 id="h">
          <CountUpText text="6,705" /> 件
        </h2>
      </section>,
    )
    env.advance(16)
    env.intersect()
    env.advance(400)
    const frame = container.querySelector('.count-up__frame')
    expect(frame).toHaveAttribute('aria-hidden', 'true')
    expect(frame?.textContent).not.toBe('6,705')
    expect(container.querySelector('.count-up__final')?.textContent).toBe('6,705')
    // 見出しの名前（aria-labelledby）は最後の値だけ。aria-live は付けない
    expect(screen.getByRole('region', { name: '6,705 件' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '6,705 件' })).toBeInTheDocument()
    expect(container.querySelector('[aria-live]')).toBeNull()
  })

  it('COUNT-4: 画面に入るまで始まらず、入ったら 1200 ms で最後の値のふつうの文字に戻る。1 回だけ', () => {
    const env = stubCountUpEnv()
    const { container } = renderInList('1 / 2', { hold: [1] })
    env.advance(3000)
    // まだ見えていない: 始まりのコマのまま
    expect(frameOf(container)).toBe('0 / 2')
    env.intersect()
    env.advance(16)
    expect(frameOf(container)).toBe('0 / 2')
    env.advance(600)
    expect(frameOf(container)).toBe('1 / 2')
    env.advance(600)
    // 終わった: 1 つの文字の並びで、今の表示と同じ
    expect(frameOf(container)).toBeNull()
    expect(screen.getByTestId('sentence').textContent).toBe('平均 1 / 2。')
    expect(container.querySelector('.count-up')?.childNodes).toHaveLength(1)
    expect(env.watching()).toBe(0)
    // 画面の外に出て戻っても数え直さない
    env.intersect()
    env.advance(100)
    expect(frameOf(container)).toBeNull()
  })

  it('COUNT-4: 進みのコマは 0 から増えていき、途中で最後の値を超えない', () => {
    const env = stubCountUpEnv()
    const { container } = renderInList('6,705')
    env.intersect()
    const seen: number[] = []
    for (let i = 0; i < 80; i += 1) {
      env.advance(16)
      const f = frameOf(container)
      if (f !== null) seen.push(Number(f.replace(/,/g, '')))
    }
    expect(seen[0]).toBe(0)
    expect(seen.length).toBeGreaterThan(30)
    for (let i = 1; i < seen.length; i += 1)
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1] ?? 0)
    expect(Math.max(...seen)).toBeLessThanOrEqual(6705)
    expect(container.querySelector('.count-up')?.textContent).toBe('6,705')
  })

  it('COUNT-5: 始まりは「見えたとき」と「mount から notBeforeMs」の遅いほう', () => {
    const env = stubCountUpEnv()
    const early = renderInList('100', { notBeforeMs: 1000 })
    env.advance(16)
    env.intersect()
    // 見えたが、mount から 1000 ms までは動かない
    env.advance(900)
    expect(frameOf(early.container)).toBe('0')
    env.advance(300)
    expect(Number(frameOf(early.container))).toBeGreaterThan(0)
    early.unmount()

    // mount から 2000 ms 後に見えたら、そこからすぐ始まる（notBeforeMs を待ち直さない）
    const late = renderInList('100', { notBeforeMs: 1000 })
    env.advance(2000)
    env.intersect()
    env.advance(200)
    expect(Number(frameOf(late.container))).toBeGreaterThan(0)
  })

  it('数字の無い値（「—」）は動かさない', () => {
    stubCountUpEnv()
    const { container } = renderInList('—')
    expect(container.querySelector('[aria-hidden]')).toBeNull()
    expect(screen.getByTestId('sentence').textContent).toBe('平均 —。')
  })

  it('COUNT-6: count-up.css は tabular-nums で、最後の値（透明）と見える数字を同じ場所に重ねる', () => {
    expect(css).toMatch(/\.count-up\s*\{[^}]*font-variant-numeric:\s*tabular-nums/)
    expect(css).toMatch(/grid-area:\s*1\s*\/\s*1/)
    expect(css).toMatch(/\.count-up__final\s*\{[^}]*opacity:\s*0/)
    // 読み上げから外す隠し方を使わない
    expect(css).not.toMatch(/\.count-up__final\s*\{[^}]*(visibility|display)\s*:/)
  })
})
