// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { readAlertFlag } from '@antler/schema'
import { act, cleanup, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AlertSoundContext,
  AlertSoundController,
  AlertState,
  beepIntervalMs,
  deriveAlertState,
  type AudioPort,
  type DerivedAlert,
  type GpsZone,
} from './index'

// 外側ループ（受け入れテスト）。公開 API（index.ts）だけを使い、A と B の使い方を通しで確かめる。

const ch7Flag = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../schema/fixtures/alert-flag/valid/ch7-example.json',
  ),
  'utf-8',
)

class RecordingPort implements AudioPort {
  calls: string[] = []
  unlock() {
    return Promise.resolve()
  }
  playChime() {
    this.calls.push('chime')
  }
  playBeep() {
    this.calls.push('beep')
  }
  speak(lang: string, text: string) {
    this.calls.push(`speak:${lang}:${text}`)
  }
  cancelSpeech() {
    this.calls.push('cancel')
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(2_000_000)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('受け入れ', () => {
  it('AC-1: ch7 の AlertFlag を readAlertFlag → deriveAlertState → AlertState に通すと、B と A（compact）で同じ赤が出て、ビープ 2 回のあと読み上げが 1 回鳴る', async () => {
    const { flag } = readAlertFlag(ch7Flag)
    const derived = deriveAlertState({
      flag,
      flagReceivedAt: Date.now(),
      gps: { status: 'inside', remainingKm: 14.2 },
      now: Date.now(),
      previous: null,
    })
    expect(derived).toMatchObject({ state: 'danger', distance: 58, side: 'L' })

    const port = new RecordingPort()
    const controller = new AlertSoundController(port)
    await controller.unlock()

    // B の PWA（全画面）
    const b = render(
      <AlertSoundContext.Provider value={controller}>
        <AlertState
          state={derived.state}
          distance={derived.distance}
          side={derived.side}
          lang="ja"
        />
      </AlertSoundContext.Provider>,
    )
    const bRoot = b.container.querySelector('[data-alert-state]')
    expect(bRoot).toHaveAttribute('data-alert-state', 'danger')
    expect(b.getByTestId('alert-value')).toHaveTextContent('58')
    expect(bRoot?.querySelector('[data-arrow="L"]')).not.toBeNull()
    expect(b.getByTestId('alert-headline')).toHaveTextContent('前方に鹿')

    act(() => {
      vi.advanceTimersByTime(beepIntervalMs(58))
    })
    expect(port.calls.filter((c) => c === 'beep')).toHaveLength(2)
    expect(port.calls.filter((c) => c.startsWith('speak'))).toEqual(['speak:ja:前方に鹿がいます'])
    b.unmount()

    // A の車内スマホ（compact、同じ部品）
    const a = render(
      <AlertState
        state={derived.state}
        distance={derived.distance}
        side={derived.side}
        lang="ja"
        compact
      />,
    )
    const aRoot = a.container.querySelector('[data-alert-state]')
    expect(aRoot).toHaveAttribute('data-alert-state', 'danger')
    expect(a.getByTestId('alert-value')).toHaveTextContent('58')
    expect(aRoot?.querySelector('[data-arrow="L"]')).not.toBeNull()
    expect(aRoot?.querySelector('[data-shape="octagon"]')).not.toBeNull()
  })

  it('AC-2: フラグなし・GPS がゾーン内 → zone とチャイム 1 回。ゾーン外へ出る → safe。danger は一度も出ない', async () => {
    const port = new RecordingPort()
    const controller = new AlertSoundController(port)
    await controller.unlock()
    const seen: string[] = []
    let previous: DerivedAlert | null = null

    const step = (gps: GpsZone) => {
      previous = deriveAlertState({
        flag: null,
        flagReceivedAt: null,
        gps,
        now: Date.now(),
        previous,
      })
      seen.push(previous.state)
      return previous
    }

    const first = step({ status: 'inside', remainingKm: 8 })
    const view = render(
      <AlertSoundContext.Provider value={controller}>
        <AlertState state={first.state} distance={first.distance} lang="ja" />
      </AlertSoundContext.Provider>,
    )
    for (const gps of [
      { status: 'inside' as const, remainingKm: 6 },
      { status: 'unknown' as const },
      { status: 'outside' as const, distanceKm: 20 },
    ]) {
      const next = step(gps)
      view.rerender(
        <AlertSoundContext.Provider value={controller}>
          <AlertState state={next.state} distance={next.distance} lang="ja" />
        </AlertSoundContext.Provider>,
      )
    }
    expect(seen).toEqual(['zone', 'zone', 'zone', 'safe'])
    expect(view.container.querySelector('[data-alert-state]')).toHaveAttribute(
      'data-alert-state',
      'safe',
    )
    expect(port.calls).toEqual(['chime'])
  })

  it('UC-5l: [ADDED code-reviewer] danger の AlertState が画面から外れたら、ビープと発話が止まる', async () => {
    const port = new RecordingPort()
    const controller = new AlertSoundController(port)
    await controller.unlock()
    const view = render(
      <AlertSoundContext.Provider value={controller}>
        <AlertState state="danger" distance={50} lang="ja" />
      </AlertSoundContext.Provider>,
    )
    expect(port.calls).toContain('beep')
    view.unmount()
    const beeps = port.calls.filter((c) => c === 'beep').length
    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    expect(port.calls.filter((c) => c === 'beep')).toHaveLength(beeps)
    expect(port.calls.at(-1)).toBe('cancel')
  })
})
