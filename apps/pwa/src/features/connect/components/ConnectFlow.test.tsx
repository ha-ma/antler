import { AlertSoundController, type AudioPort } from '@antler/alert-ui'
import { ClientMessageSchema } from '@antler/schema'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logger } from '@/shared/utils/logger'
import { FakeSocket } from '@/test/fake-socket'
import type { LocationDeps, PermissionStatusLike } from '../lib/location'
import type { ConnectServices } from '../types'
import { ConnectFlow } from './ConnectFlow'

function flag(over: Record<string, unknown> = {}) {
  const sent = new Date(Date.now()).toISOString()
  return {
    type: 'flag',
    v: 1,
    deer: false,
    zone: 'outside',
    zoneDistanceKm: 12.3,
    t_frame: new Date(Date.now() - 150).toISOString(),
    t_sent: sent,
    ...over,
  }
}

type Rig = {
  services: ConnectServices
  port: { [K in keyof AudioPort]: ReturnType<typeof vi.fn> }
  sound: AlertSoundController
  getCurrentPosition: ReturnType<typeof vi.fn>
}

function rig(
  over: {
    unlock?: () => Promise<void>
    languages?: string[]
    location?: Partial<LocationDeps>
  } = {},
): Rig {
  const port = {
    unlock: vi.fn(over.unlock ?? (() => Promise.resolve())),
    playChime: vi.fn(),
    playBeep: vi.fn(),
    speak: vi.fn(),
    cancelSpeech: vi.fn(),
  }
  const sound = new AlertSoundController(port)
  const getCurrentPosition = vi.fn()
  const status: PermissionStatusLike = { state: 'prompt', onchange: null }
  const services: ConnectServices = {
    url: 'ws://ezoroad.local:8765/alerts',
    createSocket: (u) => new FakeSocket(u),
    location: {
      isSecureContext: true,
      geolocation: { getCurrentPosition },
      permissions: { query: () => Promise.resolve(status) },
      ...over.location,
    },
    sound,
    playTestSound: () => {
      port.playChime()
    },
    primeSpeech: vi.fn(),
    languages: over.languages ?? ['ja-JP'],
  }
  return { services, port, sound, getCurrentPosition }
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function depart() {
  fireEvent.click(screen.getByRole('button'))
  await flush()
}

function alertState(): string | null {
  return document.querySelector('[data-alert-state]')?.getAttribute('data-alert-state') ?? null
}

function acks(): unknown[] {
  return FakeSocket.instances.flatMap((s) => s.sent.map((m) => JSON.parse(m) as unknown))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2027-02-15T07:31:08.500Z'))
  FakeSocket.reset()
  vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('UC-5 B-0', () => {
  it('UC-5a: 接続状況が connecting / open / closed で文言とアイコンが変わる', async () => {
    render(<ConnectFlow services={rig().services} />)
    await flush()
    const status = () => document.querySelector('[data-link-status]')
    expect(status()?.getAttribute('data-link-status')).toBe('connecting')
    expect(status()?.textContent).toContain('接続しています')
    act(() => FakeSocket.last.serverOpen())
    expect(status()?.textContent).toContain('つながっています')
    expect(status()?.querySelector('[data-link-icon="open"]')).not.toBeNull()
    act(() => FakeSocket.last.serverClose())
    expect(status()?.textContent).toContain('未接続')
    expect(status()?.querySelector('[data-link-icon="closed"]')).not.toBeNull()
  })

  it('UC-5b: 受信/秒と遅延が出る。受信が無いと「--」', async () => {
    render(<ConnectFlow services={rig().services} />)
    await flush()
    expect(screen.getByTestId('rate').textContent).toBe('--')
    expect(screen.getByTestId('delay').textContent).toBe('--')
    act(() => {
      FakeSocket.last.serverOpen()
      FakeSocket.last.serverSend(flag())
    })
    expect(screen.getByTestId('rate').textContent).toBe('0.2')
    expect(screen.getByTestId('delay').textContent).toBe('150')
  })

  it('UC-5c: 音量の案内と、緑・琥珀・赤の 3 つのプレビュー。プレビューは鳴らさない', async () => {
    const r = rig()
    render(<ConnectFlow services={r.services} />)
    await flush()
    expect(screen.getByText('スマホの音量を最大にしてください')).toBeInTheDocument()
    const states = [...document.querySelectorAll('[data-preview] [data-alert-state]')].map((e) =>
      e.getAttribute('data-alert-state'),
    )
    expect(states).toEqual(['safe', 'zone', 'danger'])
    expect(r.port.playChime).not.toHaveBeenCalled()
    expect(r.port.playBeep).not.toHaveBeenCalled()
  })

  it('UC-5e: navigator.languages が zh-TW なら主文が zh', async () => {
    render(<ConnectFlow services={rig({ languages: ['zh-TW'] }).services} />)
    await flush()
    expect(screen.getByRole('button').textContent).toBe('播放測試音並出發')
  })
})

describe('UC-6 出発', () => {
  it('UC-6a: ボタンで unlock → テスト音（チャイム）→ B-1 に進む', async () => {
    const r = rig()
    render(<ConnectFlow services={r.services} />)
    await flush()
    await depart()
    expect(r.port.unlock).toHaveBeenCalledTimes(1)
    expect(r.port.playChime).toHaveBeenCalled()
    expect(r.services.primeSpeech).toHaveBeenCalledTimes(1)
    expect(alertState()).not.toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('UC-6b: unlock が失敗しても B-1 に進み、「音が出ません」が出る', async () => {
    const r = rig({ unlock: () => Promise.reject(new Error('blocked')) })
    render(<ConnectFlow services={r.services} />)
    await flush()
    await depart()
    expect(alertState()).not.toBeNull()
    expect(screen.getByTestId('note-no-sound').textContent).toBe('音が出ません')
    expect(r.port.playChime).not.toHaveBeenCalled()
  })

  it('UC-6c: 連打しても unlock・移行は 1 回', async () => {
    const r = rig()
    render(<ConnectFlow services={r.services} />)
    await flush()
    const button = screen.getByRole('button')
    fireEvent.click(button)
    fireEvent.click(button)
    await flush()
    expect(r.port.unlock).toHaveBeenCalledTimes(1)
    expect(r.services.primeSpeech).toHaveBeenCalledTimes(1)
  })

  it('UC-6d: 未接続でも押せる', async () => {
    render(<ConnectFlow services={rig().services} />)
    await flush()
    expect(screen.getByRole('button')).toBeEnabled()
    await depart()
    expect(alertState()).toBe('zone')
  })

  it('UC-6e: prompt のとき getCurrentPosition を 1 回呼ぶ。denied では呼ばない', async () => {
    const prompt = rig()
    const { unmount } = render(<ConnectFlow services={prompt.services} />)
    await flush()
    await depart()
    expect(prompt.getCurrentPosition).toHaveBeenCalledTimes(1)
    unmount()

    const status: PermissionStatusLike = { state: 'denied', onchange: null }
    const denied = rig({ location: { permissions: { query: () => Promise.resolve(status) } } })
    render(<ConnectFlow services={denied.services} />)
    await flush()
    expect(screen.getByText(/位置の許可がありません/)).toBeInTheDocument()
    await depart()
    expect(denied.getCurrentPosition).not.toHaveBeenCalled()
  })

  it('UC-6f: denied のとき B-1 に「位置情報なし」。琥珀のまま', async () => {
    const status: PermissionStatusLike = { state: 'denied', onchange: null }
    const r = rig({ location: { permissions: { query: () => Promise.resolve(status) } } })
    render(<ConnectFlow services={r.services} />)
    await flush()
    await depart()
    expect(screen.getByTestId('note-no-location').textContent).toBe('位置情報なし')
    expect(alertState()).toBe('zone')
  })

  it('UC-6i: 安全なコンテキストでないときは、設定の許可を促さず「この接続では使えません」', async () => {
    const r = rig({ location: { isSecureContext: false } })
    render(<ConnectFlow services={r.services} />)
    await flush()
    expect(screen.getByText(/この接続では位置情報が使えません/)).toBeInTheDocument()
    expect(screen.queryByText(/設定で/)).toBeNull()
    await depart()
    expect(screen.getByTestId('note-no-location')).toBeInTheDocument()
  })

  it('UC-6j: 走行中に canPlay が偽になったら「音が出ません」が出る', async () => {
    const r = rig()
    render(<ConnectFlow services={r.services} />)
    await flush()
    await depart()
    expect(screen.queryByTestId('note-no-sound')).toBeNull()
    // 走行中の再生の失敗（AudioContext が止まるなど）
    r.port.playChime.mockImplementation(() => {
      throw new Error('suspended')
    })
    r.port.playBeep.mockImplementation(() => {
      throw new Error('suspended')
    })
    act(() => {
      FakeSocket.last.serverOpen()
      FakeSocket.last.serverSend(flag({ deer: true, conf: 0.9, distanceM: 30, side: 'L' }))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(screen.getByTestId('note-no-sound')).toBeInTheDocument()
  })

  it('UC-6g: ボタンは 44 px 以上で、アクセシブルな名前を持つ', async () => {
    render(<ConnectFlow services={rig().services} />)
    await flush()
    expect(screen.getByRole('button', { name: 'テスト音を鳴らして出発' })).toBeInTheDocument()
    const css = readFileSync(
      resolve(process.cwd(), 'src/features/connect/components/connect.css'),
      'utf8',
    )
    const rule = /\.connect__depart\s*\{[^}]*min-height:\s*(\d+)px/.exec(css)
    expect(Number(rule?.[1])).toBeGreaterThanOrEqual(44)
  })

  it('UC-6h/UC-4h: B-1 に操作要素（button・link・入力）が無い', async () => {
    render(<ConnectFlow services={rig().services} />)
    await flush()
    await depart()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
  })
})

describe('UC-4 表示と S パターン', () => {
  async function drive(r = rig()) {
    render(<ConnectFlow services={r.services} />)
    await flush()
    await depart()
    return r
  }

  it('UC-4a / S-1: 起動直後は琥珀で距離「--」。「未接続」帯が出ている', async () => {
    await drive()
    expect(alertState()).toBe('zone')
    expect(screen.getByTestId('alert-value').textContent).toBe('--')
    expect(screen.getByTestId('band').textContent).toBe('未接続')
  })

  it('UC-4b / S-2: zone:outside のフラグで緑、距離は zoneDistanceKm。帯は消える', async () => {
    await drive()
    act(() => {
      FakeSocket.last.serverOpen()
      FakeSocket.last.serverSend(flag())
    })
    expect(alertState()).toBe('safe')
    expect(screen.getByTestId('alert-value').textContent).toBe('12')
    expect(screen.getByTestId('band').textContent).toBe('')
  })

  it('UC-4c: deer:true で赤、方向と距離 m が出る', async () => {
    await drive()
    act(() => {
      FakeSocket.last.serverOpen()
      FakeSocket.last.serverSend(flag({ deer: true, conf: 0.9, distanceM: 58, side: 'L' }))
    })
    expect(alertState()).toBe('danger')
    expect(screen.getByTestId('alert-value').textContent).toBe('58')
  })

  it('UC-4d / S-3: 切断しても最後の inside / outside を保つ', async () => {
    await drive()
    act(() => {
      FakeSocket.last.serverOpen()
      FakeSocket.last.serverSend(flag())
    })
    act(() => FakeSocket.last.serverClose())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    expect(alertState()).toBe('safe')
    expect(screen.getByTestId('band').textContent).toBe('未接続')
  })

  it('UC-4e: 最後が deer:true のまま切れても受信から 5 秒は赤、超えたら解ける', async () => {
    await drive()
    act(() => {
      FakeSocket.last.serverOpen()
      FakeSocket.last.serverSend(flag({ deer: true, conf: 0.9, distanceM: 20, side: 'R' }))
    })
    act(() => FakeSocket.last.serverClose())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })
    expect(alertState()).toBe('danger')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(alertState()).not.toBe('danger')
  })

  it('UC-4f: open でないあいだ帯（role=status）が出て、open で消える。面は変わらない', async () => {
    await drive()
    const band = screen.getByTestId('band')
    expect(band).toHaveAttribute('role', 'status')
    expect(band.getAttribute('data-visible')).toBe('true')
    const face = document.querySelector('[data-alert-state]')
    const before = face?.getAttribute('style')
    act(() => FakeSocket.last.serverOpen())
    expect(band.getAttribute('data-visible')).toBe('false')
    expect(document.querySelector('[data-alert-state]')?.getAttribute('style')).toBe(before)
  })

  it('UC-4g: 帯の色は alert-* を使わない。色は CSS 変数だけ', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/features/connect/components/connect.css'),
      'utf8',
    )
    const band = /\.drive__band\s*\{[^}]*\}/.exec(css)?.[0] ?? ''
    expect(band).toContain('var(--ink-muted)')
    expect(band).toContain('var(--surface-sunken)')
    expect(css).not.toMatch(/--alert-/)
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})

describe('UC-3 ack（描画との結合）', () => {
  async function drive(r = rig()) {
    render(
      <StrictMode>
        <ConnectFlow services={r.services} />
      </StrictMode>,
    )
    await flush()
    await depart()
    return r
  }

  it('UC-3a/3b: danger の表示を始めたとき 1 回だけ ack。danger の間は再送せず、解除後にまた danger なら 1 回', async () => {
    await drive()
    act(() => FakeSocket.last.serverOpen())
    act(() => {
      FakeSocket.last.serverSend(flag({ deer: true, conf: 0.9, distanceM: 58, side: 'L' }))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    act(() => {
      FakeSocket.last.serverSend(flag({ deer: true, conf: 0.9, distanceM: 40, side: 'L' }))
    })
    const sent = acks()
    expect(sent).toHaveLength(1)
    expect(ClientMessageSchema.safeParse(sent[0]).success).toBe(true)
    expect((sent[0] as { t_shown: string }).t_shown).toMatch(/\+09:00$/)

    act(() => {
      FakeSocket.last.serverSend(flag())
    })
    expect(alertState()).toBe('safe')
    act(() => {
      FakeSocket.last.serverSend(flag({ deer: true, conf: 0.9, distanceM: 30, side: 'R' }))
    })
    expect(acks()).toHaveLength(2)
  })

  it('UC-3d: safe・zone では送らない', async () => {
    await drive()
    act(() => {
      FakeSocket.last.serverOpen()
      FakeSocket.last.serverSend(flag())
      FakeSocket.last.serverSend(
        flag({ zone: 'inside', zoneRemainingKm: 3, zoneDistanceKm: undefined }),
      )
    })
    expect(acks()).toHaveLength(0)
  })

  it('UC-3c: open でないときは送らず、あとから送り直さない', async () => {
    await drive()
    // まだ open でない状態で danger を表示する経路は無いので、open → danger → 切断 → 再接続を確かめる
    act(() => {
      FakeSocket.last.serverOpen()
      FakeSocket.last.serverSend(flag({ deer: true, conf: 0.9, distanceM: 58, side: 'L' }))
    })
    expect(acks()).toHaveLength(1)
    act(() => FakeSocket.last.serverClose())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    act(() => FakeSocket.last.serverOpen())
    expect(acks()).toHaveLength(1)
  })

  it('UC-3e: deer:true の最中に出発して B-1 がいきなり danger でも 1 回（StrictMode でも）', async () => {
    const r = rig()
    render(
      <StrictMode>
        <ConnectFlow services={r.services} />
      </StrictMode>,
    )
    await flush()
    act(() => {
      FakeSocket.last.serverOpen()
      FakeSocket.last.serverSend(flag({ deer: true, conf: 0.9, distanceM: 58, side: 'L' }))
    })
    // B-0 のプレビューでは送らない
    expect(acks()).toHaveLength(0)
    await depart()
    expect(alertState()).toBe('danger')
    expect(acks()).toHaveLength(1)
  })
})

describe('UC-2f StrictMode', () => {
  it('UC-2f: StrictMode の二重マウントでも生きている接続は 1 本', async () => {
    render(
      <StrictMode>
        <ConnectFlow services={rig().services} />
      </StrictMode>,
    )
    await flush()
    const live = FakeSocket.instances.filter((s) => s.closeCalls === 0)
    expect(live).toHaveLength(1)
  })

  it('UC-2f: アンマウントで接続もタイマーも残らない', async () => {
    const { unmount } = render(<ConnectFlow services={rig().services} />)
    await flush()
    act(() => FakeSocket.last.serverOpen())
    unmount()
    expect(FakeSocket.last.closeCalls).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('AC-2 受け入れ（画面）', () => {
  it('AC-2: B-0 → 出発 → B-1 で 3 状態が出る。切ると「未接続」帯が出て、戻すと消える', async () => {
    const r = rig()
    render(<ConnectFlow services={r.services} />)
    await flush()
    act(() => FakeSocket.last.serverOpen())
    await depart()

    act(() => {
      FakeSocket.last.serverSend(flag())
    })
    expect(alertState()).toBe('safe')

    act(() => {
      FakeSocket.last.serverSend(
        flag({ zone: 'inside', zoneRemainingKm: 3.4, zoneDistanceKm: undefined }),
      )
    })
    expect(alertState()).toBe('zone')

    act(() => {
      FakeSocket.last.serverSend(
        flag({
          deer: true,
          conf: 0.9,
          distanceM: 58,
          side: 'L',
          zone: 'inside',
          zoneRemainingKm: 3.4,
          zoneDistanceKm: undefined,
        }),
      )
    })
    expect(alertState()).toBe('danger')

    act(() => FakeSocket.last.serverClose())
    expect(screen.getByTestId('band').textContent).toBe('未接続')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    act(() => FakeSocket.last.serverOpen())
    expect(screen.getByTestId('band').textContent).toBe('')
  })
})
