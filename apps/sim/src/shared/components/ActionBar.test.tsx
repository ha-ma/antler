import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen, within } from '@testing-library/react'
import { ActionBar, ACTION_BAR_PRIMARY } from './ActionBar'

// 画面の下に固定する帯（docs/specs/sticky-cta/functional.md R1・R2・S-1）。
// vitest は CSS を空にして読むので、ファイルを直に読んで中身を確かめる（loss・record のテストと同じ）。

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, 'action-bar.css'), 'utf8')
const pageCss = (path: string) => readFileSync(join(here, '../../features', path), 'utf8')

/** CSS の文字列から `head { … }` の中身を取り出す（入れ子の {} を数える）。同じ見出しが複数あればつなぐ */
function cssBlocks(source: string, head: string): string {
  const out: string[] = []
  let from = 0
  for (;;) {
    const start = source.indexOf(`${head} {`, from)
    if (start < 0) break
    let depth = 0
    const open = source.indexOf('{', start)
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1
      if (source[i] === '}') depth -= 1
      if (depth === 0) {
        out.push(source.slice(open + 1, i))
        from = i
        break
      }
    }
  }
  return out.join('\n')
}

describe('ActionBar（sticky-cta）', () => {
  it('BAR-1 中身を帯の中に 1 つだけ描き、補足は渡したときだけ描く', () => {
    const { rerender } = render(
      <ActionBar>
        <button type="button" className={ACTION_BAR_PRIMARY}>
          次へ
        </button>
      </ActionBar>,
    )
    const bar = screen.getByTestId('action-bar')
    expect(within(bar).getAllByRole('button', { name: '次へ' })).toHaveLength(1)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(bar.querySelector('.action-bar__note')).toBeNull()

    rerender(
      <ActionBar note={<p>直すところ: 人数</p>}>
        <button type="button" className={ACTION_BAR_PRIMARY}>
          次へ
        </button>
      </ActionBar>,
    )
    expect(within(screen.getByTestId('action-bar')).getByText('直すところ: 人数')).toBeVisible()
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('BAR-2 帯は下に固定、面は surface と line、主ボタンは spruce の 44px 以上。alert- と 16 進の色を使わない', () => {
    const bar = cssBlocks(css, '.action-bar')
    expect(bar).toContain('position: fixed')
    expect(bar).toContain('bottom: 0')
    expect(bar).toContain('env(safe-area-inset-bottom')
    expect(bar).toContain('background: var(--surface)')
    expect(bar).toContain('border-top: 1px solid var(--line)')

    const primary = cssBlocks(css, '.action-bar .action-bar__primary')
    expect(primary).toContain('background: var(--spruce)')
    expect(primary).toContain('color: var(--on-spruce)')
    expect(primary).toContain('box-shadow: 0 6px 0 var(--spruce-deep)')
    const heights = [...primary.matchAll(/min-height: (\d+)px/g)].map((m) => Number(m[1]))
    expect(heights.length).toBeGreaterThan(0)
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(44)

    // Tab で進んだ先が帯に隠れない（WCAG 2.4.11）
    expect(cssBlocks(css, ':root:has(.action-bar)')).toContain(
      'scroll-padding-bottom: var(--action-bar-reserve)',
    )
    // night の spruce-deep は on-spruce と 3.07:1 なので、ホバー・処理中も面は spruce のまま
    expect(
      cssBlocks(css, "[data-theme='night'] .action-bar .action-bar__primary[aria-disabled='true']"),
    ).toContain('background: var(--spruce)')

    expect(css).not.toMatch(/alert-(safe|zone|danger)/)
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('BAR-3 動きを減らす設定では主ボタンを動かさず、動きの最後の形に transform が残らない', () => {
    const reduced = cssBlocks(css, '@media (prefers-reduced-motion: reduce)')
    expect(reduced).toContain('.action-bar .action-bar__primary')
    expect(reduced).toContain('animation: none')
    const keyframes = cssBlocks(css, '@keyframes action-bar-nudge')
    // 0%・40%・100% は止まった形
    expect(keyframes).toMatch(/100% \{\s*transform: none;/)
    // 終わったあとに transform を持ち続けない（押したときの沈みが効く）
    expect(cssBlocks(css, '.action-bar .action-bar__primary')).not.toMatch(
      /animation:[^;]*\b(both|forwards)\b/,
    )
    // 点滅（不透明度・色の明滅）をしない
    expect(keyframes).not.toMatch(/opacity|background|color/)
  })

  it('BAR-4 各画面の本文の下の余白に帯の高さを足す（帯が本文を隠さない）', () => {
    expect(css).toMatch(/--action-bar-reserve: calc\(\d+px \+ env\(safe-area-inset-bottom/)
    const pages: [string, string][] = [
      ['plan-trip/components/plan-trip.css', '.plan-body'],
      ['brief-map/components/brief-map.css', '.brief-body'],
      ['loss/components/loss.css', '.loss-body'],
      ['record/components/record.css', '.record-main'],
    ]
    for (const [file, selector] of pages) {
      expect(cssBlocks(pageCss(file), selector), file).toContain('var(--action-bar-reserve, 0px)')
    }
  })
})
