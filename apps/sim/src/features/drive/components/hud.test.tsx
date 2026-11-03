import { AlertSoundController, type AudioPort, type DerivedAlert } from '@antler/alert-ui'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DriveEngine, DriveSnapshot } from '../domain/engine'
import { DangerOverlay } from './hud/DangerOverlay'
import { TopBar } from './hud/TopBar'
import { ZoneStatusPanel } from './hud/ZoneStatusPanel'
import { PhoneScreen } from './PhoneScreen'

const base: DriveSnapshot = {
  t: 65 * 60_000,
  clockMs: Date.parse('2027-02-15T16:52+09:00'),
  sunsetMs: Date.parse('2027-02-15T16:56+09:00'),
  speedKmh: 60,
  playback: { rate: 1, paused: false, locked: false },
  zone: {
    gps: { status: 'outside', distanceKm: 1.2 },
    interval: null,
    nextEntryKm: 1.5,
    positionKm: 0.3,
  },
  nextZoneEtaMs: Date.parse('2027-02-15T16:54+09:00'),
  alert: { state: 'safe', distance: 1.2, inZone: false },
  light: 'dusk',
  outcome: 'driving',
  alertEnabled: true,
  lang: 'ja',
  weather: 'cloudy',
  surface: 'packed-snow',
  encounters: [],
}

const danger: DerivedAlert = { state: 'danger', distance: 42, side: 'L', inZone: true }

/** スナップショットを差し替えられる偽のエンジン（購読だけ） */
function fakeEngine(initial: DriveSnapshot) {
  let snap = initial
  const listeners = new Set<() => void>()
  const engine = {
    subscribe: (l: () => void) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    getSnapshot: () => snap,
  }
  const set = (next: DriveSnapshot) => {
    snap = next
    listeners.forEach((l) => l())
  }
  return { engine: engine as unknown as DriveEngine, set }
}

function fakePort(): AudioPort {
  return {
    unlock: vi.fn(() => Promise.resolve()),
    playChime: vi.fn(),
    playBeep: vi.fn(),
    speak: vi.fn(),
    cancelSpeech: vi.fn(),
  }
}

describe('アラートの見せ方（R7）', () => {
  it('UC-7a: danger でビネットと中央上のバナー「前方に鹿 左 42 m」、スマホの AlertState が赤', () => {
    render(<DangerOverlay alert={danger} lang="ja" />)
    expect(screen.getByTestId('danger-vignette')).toBeInTheDocument()
    expect(screen.getByTestId('danger-banner')).toHaveTextContent('前方に鹿 左 42 m ブレーキ')
    const { engine } = fakeEngine({ ...base, alert: danger })
    render(<PhoneScreen engine={engine} controller={null} muted={false} />)
    const phone = document.querySelector('[data-alert-state]')
    expect(phone).toHaveAttribute('data-alert-state', 'danger')
    expect(phone).toHaveAttribute('data-compact', 'true')
  })

  it('UC-7a: 旅程の言語でバナーを出す（en）。danger でなければ何も描かない', () => {
    const { container, rerender } = render(<DangerOverlay alert={danger} lang="en" />)
    expect(screen.getByTestId('danger-banner')).toHaveTextContent('DEER AHEAD LEFT 42 m BRAKE')
    rerender(<DangerOverlay alert={{ state: 'zone', distance: 3, inZone: true }} lang="en" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('UC-7b: 距離が変わるたびに音のコントローラへ state・距離・言語・消音を渡す', () => {
    const controller = new AlertSoundController(fakePort())
    const update = vi.spyOn(controller, 'update')
    const { engine, set } = fakeEngine({ ...base, alert: danger })
    const { rerender } = render(
      <PhoneScreen engine={engine} controller={controller} muted={false} />,
    )
    expect(update).toHaveBeenLastCalledWith({
      state: 'danger',
      distance: 42,
      lang: 'ja',
      muted: false,
    })
    act(() => set({ ...base, alert: { ...danger, distance: 30 } }))
    expect(update).toHaveBeenLastCalledWith({
      state: 'danger',
      distance: 30,
      lang: 'ja',
      muted: false,
    })
    rerender(<PhoneScreen engine={engine} controller={controller} muted />)
    expect(update).toHaveBeenLastCalledWith({
      state: 'danger',
      distance: 30,
      lang: 'ja',
      muted: true,
    })
  })

  it('UC-7d: 左上は safe で「次の鹿ゾーンまで n km・到達 hh:mm」、zone で「残り n km」', () => {
    const { rerender } = render(<ZoneStatusPanel snapshot={base} />)
    expect(screen.getByTestId('zone-status')).toHaveTextContent(
      '次の鹿ゾーンまで 1.2 km・到達 16:54',
    )
    rerender(
      <ZoneStatusPanel
        snapshot={{
          ...base,
          zone: { ...base.zone, gps: { status: 'inside', remainingKm: 8.4 } },
          alert: { state: 'zone', distance: 8.4, inZone: true },
        }}
      />,
    )
    expect(screen.getByTestId('zone-status')).toHaveTextContent('鹿ゾーン走行中 残り 8.4 km')
    expect(screen.getByTestId('zone-status')).toHaveAttribute('data-state', 'zone')
    rerender(
      <ZoneStatusPanel
        snapshot={{ ...base, zone: { ...base.zone, gps: { status: 'outside' } } }}
      />,
    )
    expect(screen.getByTestId('zone-status')).toHaveTextContent('この先に鹿ゾーンはありません')
  })

  it('UC-7f: 上部に日付・時刻・日没（JST）。ゾーン内では 4× / 16× が押せず、理由が出る', async () => {
    const onRate = vi.fn()
    const onPause = vi.fn()
    const { rerender } = render(<TopBar snapshot={base} onRate={onRate} onPause={onPause} />)
    expect(screen.getByTestId('clock')).toHaveTextContent('2/15')
    expect(screen.getByTestId('clock')).toHaveTextContent('16:52')
    expect(screen.getByTestId('clock')).toHaveTextContent('日没 16:56')
    await userEvent.click(screen.getByRole('button', { name: '16×' }))
    expect(onRate).toHaveBeenCalledWith(16)

    rerender(
      <TopBar
        snapshot={{ ...base, playback: { rate: 1, paused: false, locked: true } }}
        onRate={onRate}
        onPause={onPause}
      />,
    )
    expect(screen.getByRole('button', { name: '4×' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '16×' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '1×' })).toBeEnabled()
    expect(screen.getByText('鹿ゾーンの中は 1× だけ')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '一時停止' }))
    expect(onPause).toHaveBeenCalledWith(true)
  })
})
