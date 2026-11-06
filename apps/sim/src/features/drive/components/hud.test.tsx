import { AlertSoundController, type AudioPort, type DerivedAlert } from '@antler/alert-ui'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import type { DriveEngine, DriveSnapshot } from '../domain/engine'
import { demoScenario } from '../domain/scenario'
import { ZONES } from '../domain/zones-data'
import { DangerOverlay } from './hud/DangerOverlay'
import { RoutePanel } from './hud/RoutePanel'
import { StageBanner } from './hud/StageBanner'
import { TopBar } from './hud/TopBar'
import { ZoneStatusPanel } from './hud/ZoneStatusPanel'
import { PhoneScreen } from './PhoneScreen'
import { StartOverlay } from './StartOverlay'

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
  stage: { index: 1, count: 2 },
  stageClearedAt: null,
  destination: { km: 30.2, etaMs: Date.parse('2027-02-15T17:30+09:00') },
  spotting: { appeared: 0, found: 0, early: 0 },
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

describe('いまの区間の案内とステージ（drive-tune R1・R4）', () => {
  const scenario = {
    ...demoScenario(ZONES),
    stops: ['drift-ice-walk'],
    day: 3,
    from: 'kushiro',
    to: 'shiretoko',
  }

  it('UC-4a: 左の案内に D の番号・出発地 → 到着地・目的地までの km と到着予定・ステージ n / m・その日の楽しみ', () => {
    render(<RoutePanel scenario={scenario} snapshot={base} />)
    const panel = screen.getByTestId('route-panel')
    expect(panel).toHaveTextContent('D3 釧路 → 知床')
    expect(panel).toHaveTextContent('目的地まで 30 km・到着予定 17:30')
    expect(panel).toHaveTextContent('ステージ 1 / 2')
    expect(panel).toHaveTextContent('今日の楽しみ')
    expect(panel).toHaveTextContent('流氷ウォーク')
    expect(panel).toHaveTextContent('知床ウトロ ・ 2月限定')
  })

  it('UC-4a: 楽しみが無い日・ゾーンの無い日は、区間と残りだけ', () => {
    render(
      <RoutePanel
        scenario={{ ...scenario, stops: [] }}
        snapshot={{ ...base, stage: { index: 0, count: 0 } }}
      />,
    )
    const panel = screen.getByTestId('route-panel')
    expect(panel).not.toHaveTextContent('今日の楽しみ')
    expect(panel).not.toHaveTextContent('ステージ')
  })

  it('UC-1c: クリアの帯は、クリアしてから 2 秒（シミュレーションの時計）だけ出る', () => {
    const cleared = { ...base, stage: { index: 2, count: 2 }, stageClearedAt: base.t - 500 }
    const { rerender } = render(<StageBanner snapshot={cleared} />)
    expect(screen.getByTestId('stage-banner')).toHaveTextContent('ステージ 1 / 2 クリア')
    rerender(<StageBanner snapshot={{ ...cleared, t: base.t + 2000 }} />)
    expect(screen.queryByTestId('stage-banner')).toBeNull()
  })

  it('UC-1e: ゾーンの無い日は、出発の案内に「この日は鹿ゾーンを通りません」', () => {
    render(
      <MemoryRouter>
        <StartOverlay scenario={scenario} noZone onStart={() => undefined} />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('no-zone')).toHaveTextContent('この日は鹿ゾーンを通りません')
  })
})
