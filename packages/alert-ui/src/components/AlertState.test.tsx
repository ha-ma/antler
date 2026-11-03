// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AlertState } from './AlertState'

afterEach(() => {
  cleanup()
})

const root = () => document.querySelector('[data-alert-state]') as HTMLElement

describe('UC-3 状態ごとの表示', () => {
  it('UC-3a / S-1: safe 38 → 円＋チェック、「38」「km」、主文「鹿ゾーンまで」、背景は --alert-safe', () => {
    render(<AlertState state="safe" distance={38} lang="ja" />)
    expect(root()).toHaveAttribute('data-alert-state', 'safe')
    expect(root().querySelector('[data-shape="circle"]')).not.toBeNull()
    expect(root().querySelector('[data-icon="check"]')).not.toBeNull()
    expect(screen.getByTestId('alert-value')).toHaveTextContent('38')
    expect(screen.getByTestId('alert-unit')).toHaveTextContent('km')
    expect(screen.getByTestId('alert-headline')).toHaveTextContent('鹿ゾーンまで')
    expect(root().style.background).toBe('var(--alert-safe)')
    expect(root().style.color).toBe('var(--on-alert-safe)')
  })

  it('UC-3b / S-2: zone 14.2 → 三角＋鹿ピクト、「14」「km」、「鹿ゾーン走行中」「減速 50 km/h 以下に」、背景は --alert-zone', () => {
    render(<AlertState state="zone" distance={14.2} lang="ja" />)
    expect(root().querySelector('[data-shape="triangle"]')).not.toBeNull()
    expect(root().querySelector('[data-icon="deer"]')).not.toBeNull()
    expect(screen.getByTestId('alert-value')).toHaveTextContent('14')
    expect(screen.getByTestId('alert-headline')).toHaveTextContent('鹿ゾーン走行中')
    expect(screen.getByTestId('alert-action')).toHaveTextContent('減速 50 km/h 以下に')
    expect(root().style.background).toBe('var(--alert-zone)')
  })

  it('UC-3c / S-3: danger 58 L → 八角＋鹿ピクト、左矢印、「58」「m」、「前方に鹿」「ブレーキ」、背景は --alert-danger', () => {
    render(<AlertState state="danger" distance={58} side="L" lang="ja" />)
    expect(root().querySelector('[data-shape="octagon"]')).not.toBeNull()
    expect(root().querySelector('[data-icon="deer"]')).not.toBeNull()
    expect(root().querySelector('[data-arrow="L"]')).not.toBeNull()
    expect(screen.getByTestId('alert-value')).toHaveTextContent('58')
    expect(screen.getByTestId('alert-unit')).toHaveTextContent('m')
    expect(screen.getByTestId('alert-headline')).toHaveTextContent('前方に鹿')
    expect(screen.getByTestId('alert-action')).toHaveTextContent('ブレーキ')
    expect(root().style.background).toBe('var(--alert-danger)')
    expect(root().style.color).toBe('var(--on-alert-danger)')
  })

  it('UC-3d: danger で side 無し → 前方の矢印。side R → 右矢印。safe / zone には矢印が無い', () => {
    const { rerender } = render(<AlertState state="danger" distance={40} lang="ja" />)
    expect(root().querySelector('[data-arrow="front"]')).not.toBeNull()
    rerender(<AlertState state="danger" distance={40} side="R" lang="ja" />)
    expect(root().querySelector('[data-arrow="R"]')).not.toBeNull()
    rerender(<AlertState state="zone" distance={4} lang="ja" />)
    expect(root().querySelector('[data-arrow]')).toBeNull()
  })

  it('UC-3e: 背景色はトークンの alert-* を参照し、data-theme で変わらない', () => {
    document.documentElement.dataset['theme'] = 'night'
    render(<AlertState state="zone" distance={4} lang="ja" />)
    expect(root().style.background).toBe('var(--alert-zone)')
    delete document.documentElement.dataset['theme']
    const tokensCss = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../tokens/tokens.css'),
      'utf-8',
    )
    const nightBlock = tokensCss.slice(tokensCss.indexOf("[data-theme='night']"))
    expect(nightBlock).not.toContain('--alert-')
  })

  it('distance が無い → 「--」', () => {
    render(<AlertState state="danger" distance={undefined} lang="ja" />)
    expect(screen.getByTestId('alert-value')).toHaveTextContent('--')
  })
})

describe('UC-4 点滅', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('UC-4a: danger → 白枠が 0.5 秒ごとに切り替わる（1 秒に 1 周期）。safe / zone では点滅しない', () => {
    const { rerender } = render(<AlertState state="danger" distance={50} lang="ja" />)
    const frames: (string | null)[] = [root().getAttribute('data-frame')]
    for (let i = 0; i < 4; i++) {
      act(() => {
        vi.advanceTimersByTime(500)
      })
      frames.push(root().getAttribute('data-frame'))
    }
    expect(frames).toEqual(['on', 'off', 'on', 'off', 'on'])
    rerender(<AlertState state="zone" distance={5} lang="ja" />)
    act(() => {
      vi.advanceTimersByTime(2_000)
    })
    expect(root().getAttribute('data-frame')).toBe('none')
  })

  it('UC-4b: 点滅は CSS アニメーションではなく属性の切り替え（動きを減らす設定の全体指定で止まらない）', () => {
    render(<AlertState state="danger" distance={50} lang="ja" />)
    expect(root().style.animation).toBe('')
    expect(root().getAttribute('data-frame')).toBe('on')
  })
})

describe('UC-6 言語（表示）', () => {
  it('UC-6a: lang=ja danger → 副文「DEER AHEAD ・ 前方有鹿 ・ 전방 사슴」', () => {
    render(<AlertState state="danger" distance={58} side="L" lang="ja" />)
    expect(screen.getByTestId('alert-sub')).toHaveTextContent('DEER AHEAD ・ 前方有鹿 ・ 전방 사슴')
  })

  it('UC-6b: lang=zh の safe → 主文は zh、副文は ja・en・ko', () => {
    render(<AlertState state="safe" distance={3} lang="zh" />)
    expect(screen.getByTestId('alert-headline')).toHaveTextContent('距鹿區')
    expect(screen.getByTestId('alert-sub')).toHaveTextContent(
      '鹿ゾーンまで ・ DEER ZONE AHEAD ・ 사슴 구역까지',
    )
  })
})

describe('UC-7 compact', () => {
  it('UC-7a: compact → 形と数値と矢印だけ。主文・補助文・副文が無い', () => {
    render(<AlertState state="danger" distance={58} side="L" lang="ja" compact />)
    expect(root()).toHaveAttribute('data-compact', 'true')
    expect(root().querySelector('[data-shape="octagon"]')).not.toBeNull()
    expect(root().querySelector('[data-arrow="L"]')).not.toBeNull()
    expect(screen.getByTestId('alert-value')).toHaveTextContent('58')
    expect(screen.queryByTestId('alert-headline')).toBeNull()
    expect(screen.queryByTestId('alert-action')).toBeNull()
    expect(screen.queryByTestId('alert-sub')).toBeNull()
  })
})

describe('UC-8 操作要素なし', () => {
  it('UC-8a: 3 状態とも button・a・input が無く、クリックしても表示が変わらない', () => {
    for (const state of ['safe', 'zone', 'danger'] as const) {
      render(<AlertState state={state} distance={10} lang="ja" />)
      expect(
        root().querySelectorAll('button, a, input, select, textarea, [tabindex]'),
      ).toHaveLength(0)
      const before = root().outerHTML
      fireEvent.click(root())
      expect(root().outerHTML).toBe(before)
      cleanup()
    }
  })
})

describe('UC-10 支援技術', () => {
  it('UC-10a: danger に入ると role=alert に「前方に鹿 左 58 メートル」。距離が 40 に変わっても文は変わらない', () => {
    const { rerender } = render(<AlertState state="zone" distance={3} lang="ja" />)
    rerender(<AlertState state="danger" distance={58} side="L" lang="ja" />)
    expect(screen.getByRole('alert')).toHaveTextContent('前方に鹿 左 58 メートル')
    rerender(<AlertState state="danger" distance={40} side="L" lang="ja" />)
    expect(screen.getByRole('alert')).toHaveTextContent('前方に鹿 左 58 メートル')
  })

  it('UC-10b: safe / zone は role=status で、状態が変わったときだけ文が変わる', () => {
    const { rerender } = render(<AlertState state="safe" distance={38} lang="ja" />)
    expect(screen.getByRole('status')).toHaveTextContent('鹿ゾーンまで 38 キロ')
    rerender(<AlertState state="safe" distance={30} lang="ja" />)
    expect(screen.getByRole('status')).toHaveTextContent('鹿ゾーンまで 38 キロ')
    rerender(<AlertState state="zone" distance={12} lang="ja" />)
    expect(screen.getByRole('status')).toHaveTextContent('鹿ゾーン走行中 残り 12 キロ')
  })

  it('見た目の部品は支援技術から隠し、読み上げは role の要素だけにする', () => {
    render(<AlertState state="danger" distance={58} side="L" lang="ja" />)
    expect(root().querySelector('[data-visual]')).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('UC-13 鹿ピクトの共有', () => {
  it('UC-13a: zone と danger で同じ DeerPictogram の SVG（同じ path）が描かれる', () => {
    const { rerender } = render(<AlertState state="zone" distance={4} lang="ja" />)
    const zonePaths = root().querySelector('[data-icon="deer"]')?.innerHTML
    rerender(<AlertState state="danger" distance={40} lang="ja" />)
    const dangerPaths = root().querySelector('[data-icon="deer"]')?.innerHTML
    expect(zonePaths).toBeTruthy()
    expect(dangerPaths).toBe(zonePaths)
  })
})
