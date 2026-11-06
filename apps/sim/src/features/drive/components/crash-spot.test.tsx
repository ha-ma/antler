import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AlertSoundController } from '@antler/alert-ui'
import type { Lang } from '@antler/schema'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { CRASH_MS } from '../domain/crash'
import { DriveEngine } from '../domain/engine'
import { demoScenario } from '../domain/scenario'
import { ZONES } from '../domain/zones-data'
import type { Deer, DriveResult } from '../types'
import { DrivePage } from './DrivePage'
import { SpotCount } from './hud/SpotCount'

// vitest は CSS を読み込まない（?raw も空）ので、ファイルを直接読む
const here = path.dirname(fileURLToPath(import.meta.url))
const css = readFileSync(path.join(here, 'drive.css'), 'utf8')

// drive-crash-spot の画面（docs/specs/drive-crash-spot/functional.md AC-2・UC-2a・UC-3b〜UC-3d・UC-4g）。
// 3D は jsdom で描けないので、フレームと鹿のタップだけを受ける偽物に差し替える（タップの当たりは domain で見る）。

const FRAME_MS = 1000 / 60
const START = '出発（音を出します）'
const RETRY = '同じシードでもう一度'

type Hooks = { onFrame: (dt: number) => void; onSpot: (id: string) => void }

function deer(id: string, s: number, d: number, over: Partial<Deer> = {}): Deer {
  return {
    id,
    candidateId: id,
    pattern: 'roadside',
    motion: 'graze',
    seed: 1,
    phase: 'wait',
    index: 0,
    s,
    d,
    heading: Math.PI / 2,
    pose: 'idle',
    occluded: false,
    startedAt: null,
    gone: false,
    ...over,
  }
}

function setup(search = '') {
  const engine = new DriveEngine({ ...demoScenario(ZONES, search), weather: 'clear' }, ZONES)
  const hooks: Hooks = { onFrame: () => undefined, onSpot: () => undefined }
  const canvas = (props: Hooks) => {
    hooks.onFrame = props.onFrame
    hooks.onSpot = props.onSpot
    return <div data-testid="scene" />
  }
  const onFinish = vi.fn<(r: DriveResult) => void>()
  const onCrashEnd = vi.fn<(r: DriveResult) => void>()
  vi.spyOn(AlertSoundController.prototype, 'unlock').mockResolvedValue(true)
  const view = renderWithProviders(
    <DrivePage
      createEngine={() => engine}
      canvas={canvas}
      webgl2={() => true}
      onFinish={onFinish}
      onCrashEnd={onCrashEnd}
    />,
  )
  return { engine, hooks, onFinish, onCrashEnd, view }
}

/** ゾーンの中に車を置き、90 m 先の道ばたに見える鹿（far）と、すぐ前に立つ鹿（hit）を置く */
function placeDeer(engine: DriveEngine) {
  const w = engine.world
  const s = (w.plan.intervals[0]?.entryKm ?? 0) * 1000 + 500
  w.vehicle = { ...w.vehicle, s, d: -1.75, speed: 60 / 3.6 }
  w.playback = { rate: 1, paused: false, locked: true }
  w.candidates = []
  w.deer = [
    deer('far', s + 90, 5),
    deer('hit', s + 4, -1.75, {
      pattern: 'frozen',
      motion: 'frozen',
      phase: 'stand',
      pose: 'look',
      startedAt: 0,
    }),
  ]
}

/** 衝突するまでフレームを進める */
function driveUntilCollided(engine: DriveEngine, hooks: Hooks) {
  for (let i = 0; i < 120 && engine.getSnapshot().outcome === 'driving'; i += 1) {
    act(() => hooks.onFrame(FRAME_MS))
  }
  expect(engine.getSnapshot().outcome).toBe('collided')
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('衝突の演出と鹿の発見（drive-crash-spot）', () => {
  it('AC-2: 鹿を見つけてから衝突 → その frame で spotting つきの結果を渡し、演出の間は帯が無く、3.5 秒後に 1 回だけ A-6 への合図', async () => {
    const { engine, hooks, onFinish, onCrashEnd } = setup()
    await userEvent.click(screen.getByRole('button', { name: START }))
    placeDeer(engine)
    act(() => hooks.onFrame(FRAME_MS))
    // 見えている鹿をタップ（2 回押しても 1 頭）
    act(() => {
      hooks.onSpot('far')
      hooks.onSpot('far')
    })
    expect(screen.getByTestId('spot-count')).toHaveTextContent(/^鹿を発見 1 \/ \d+ 頭$/)

    vi.useFakeTimers()
    driveUntilCollided(engine, hooks)
    expect(onFinish).toHaveBeenCalledTimes(1)
    expect(onFinish.mock.calls[0]?.[0].spotting).toMatchObject({ found: 1, early: 1 })
    // 演出の間: 暗転の層と読み上げはあり、終わりの帯（もう一度）は無い
    expect(screen.getByTestId('crash-overlay')).toBeInTheDocument()
    expect(document.querySelector('.drive')).toHaveAttribute('data-crash', 'on')
    expect(screen.queryByRole('button', { name: RETRY })).toBeNull()
    expect(onCrashEnd).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(CRASH_MS - 1))
    expect(onCrashEnd).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onCrashEnd).toHaveBeenCalledTimes(1)
    expect(onCrashEnd.mock.calls[0]?.[0]).toMatchObject({ outcome: 'collided' })
    act(() => vi.advanceTimersByTime(CRASH_MS * 2))
    expect(onCrashEnd).toHaveBeenCalledTimes(1)
  })

  it('UC-3c: 当たったことは role=alert で 1 回伝え、終わりの帯は演出のあとに出る', async () => {
    const { engine, hooks } = setup()
    await userEvent.click(screen.getByRole('button', { name: START }))
    placeDeer(engine)
    vi.useFakeTimers()
    driveUntilCollided(engine, hooks)
    expect(within(screen.getByTestId('crash-overlay')).getByRole('alert')).toHaveTextContent(
      '鹿と衝突しました',
    )
    expect(screen.queryByRole('heading', { name: '鹿と衝突しました' })).toBeNull()
    act(() => vi.advanceTimersByTime(CRASH_MS))
    expect(screen.getByRole('heading', { name: '鹿と衝突しました' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: RETRY })).toBeInTheDocument()
    expect(document.querySelector('.drive')).toHaveAttribute('data-crash', 'ended')
  })

  it('UC-3d: 演出の途中で離れる（アンマウント）・もう一度（エンジンを戻す）と、A-6 への合図は出ない', async () => {
    const first = setup()
    await userEvent.click(screen.getByRole('button', { name: START }))
    placeDeer(first.engine)
    vi.useFakeTimers()
    driveUntilCollided(first.engine, first.hooks)
    first.view.unmount()
    act(() => vi.advanceTimersByTime(CRASH_MS * 2))
    expect(first.onCrashEnd).not.toHaveBeenCalled()
    vi.useRealTimers()

    const second = setup()
    await userEvent.click(screen.getByRole('button', { name: START }))
    placeDeer(second.engine)
    vi.useFakeTimers()
    driveUntilCollided(second.engine, second.hooks)
    act(() => second.engine.restart())
    expect(screen.queryByTestId('crash-overlay')).toBeNull()
    act(() => vi.advanceTimersByTime(CRASH_MS * 2))
    expect(second.onCrashEnd).not.toHaveBeenCalled()
  })

  it('UC-2a: 車内のスマホは HUD の固定の位置に出る（アラート ON）。OFF では出さない', async () => {
    const on = setup()
    await userEvent.click(screen.getByRole('button', { name: START }))
    const phone = screen.getByTestId('drive-phone')
    expect(phone.querySelector('[data-alert-state]')).not.toBeNull()
    // 3D の偽物の中ではなく HUD の中
    expect(phone.closest('.drive-hud')).not.toBeNull()
    expect(screen.getByTestId('scene').contains(phone)).toBe(false)
    on.view.unmount()

    setup('?alert=off')
    await userEvent.click(screen.getByRole('button', { name: START }))
    expect(screen.queryByTestId('drive-phone')).toBeNull()
  })

  it('UC-3b: reduced-motion では光とぼかしを止め、暗くなるだけ（暗転の層は残す）。演出の色は ink と ground（alert-danger を使わない）', () => {
    const reduced =
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.drive-crash__flash \{\s*display: none;\s*\}\s*\.drive\[data-crash\] \.drive__scene \{\s*animation: none;\s*\}\s*\}/
    expect(css).toMatch(reduced)
    const crashRules = css.slice(css.indexOf('.drive-crash {'))
    expect(crashRules).toContain('var(--ground)')
    expect(crashRules).not.toContain('alert-danger')
  })
})

describe('UC-4g: 発見の件数（4 言語）', () => {
  const cases: [Lang, string][] = [
    ['ja', '鹿を発見 2 / 5 頭'],
    ['en', 'Deer spotted 2 / 5'],
    ['zh', '發現鹿 2 / 5 頭'],
    ['ko', '사슴 발견 2 / 5마리'],
  ]
  it.each(cases)('%s: 見えた鹿があれば 1 行、無ければ出さない', (lang, text) => {
    const { unmount } = render(
      <SpotCount spotting={{ appeared: 5, found: 2, early: 1 }} lang={lang} />,
    )
    expect(screen.getByTestId('spot-count')).toHaveTextContent(text)
    unmount()
    render(<SpotCount spotting={{ appeared: 0, found: 0, early: 0 }} lang={lang} />)
    expect(screen.queryByTestId('spot-count')).toBeNull()
  })
})
