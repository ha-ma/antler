import { AlertSoundController } from '@antler/alert-ui'
import { placeById } from '@antler/trip'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { TRIP_ID, tripDayBody } from '@/test/trip-day'
import { logger } from '@/shared/utils/logger'
import type { DriveResult, World } from '../types'
import { DriveScreen } from './DriveScreen'

// drive-link（docs/specs/drive-link/functional.md）: /drive?trip=…&day=n を API の応答から走らせる。
// api は fetch のスタブ（応答は api と同じ関数で作った src/test/trip-day.ts）。3D は偽物（jsdom に WebGL が無い）。

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

type Reply = { status: number; body: unknown }

function stubApi(reply: (day: number, call: number) => Reply) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      calls.push(url)
      const day = Number(/\/day\/(\d+)/.exec(url)?.[1] ?? 0)
      const r = reply(day, calls.length)
      return Promise.resolve(
        new Response(JSON.stringify(r.body), {
          status: r.status,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }),
  )
  return calls
}

const ok = (day: number): Reply => ({ status: 200, body: tripDayBody(day) })
const fail = (status: number, code: string): Reply => ({
  status,
  body: { error: { code, message: 'x' } },
})

type Frames = { onFrame: (dt: number) => void; world: () => World | null }

function renderDrive(path: string, onFinish?: (r: DriveResult) => void) {
  const frames: Frames = { onFrame: () => undefined, world: () => null }
  const canvas = (props: {
    world: () => World
    phone: ReactNode
    onFrame: (dt: number) => void
  }) => {
    frames.onFrame = props.onFrame
    frames.world = props.world
    return <div data-testid="phone">{props.phone}</div>
  }
  vi.spyOn(AlertSoundController.prototype, 'unlock').mockResolvedValue(true)
  const router = createMemoryRouter(
    [
      {
        path: '/drive',
        element: <DriveScreen canvas={canvas} webgl2={() => true} onFinish={onFinish} />,
      },
    ],
    { initialEntries: [path] },
  )
  renderWithProviders(<RouterProvider router={router} />)
  return frames
}

/** 案内がその文になるまで待つ（最初は「旅を読み込んでいます」が出る） */
async function expectMessage(text: string) {
  await waitFor(() => expect(screen.getByTestId('drive-message')).toHaveTextContent(text))
}
const startButton = () => screen.findByRole('button', { name: '出発（音を出します）' })

describe('drive-link 受け入れ（画面）', () => {
  it('AC-1: 1 日目を開くと、その日のタイトル・区間・条件で出発の案内が出て、出発すると次の鹿ゾーンまでの km が出る', async () => {
    const calls = stubApi(ok)
    const frames = renderDrive(`/drive?trip=${TRIP_ID}&day=1`)
    await startButton()
    expect(calls).toEqual([expect.stringMatching(/\/api\/trips\/K7m2abcd\/day\/1$/)])
    const body = tripDayBody(1)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(body.plan.title)
    const to = placeById(body.day.legs[body.day.legs.length - 1]?.to ?? '')?.name.ja ?? ''
    expect(screen.getByTestId('start-leg')).toHaveTextContent(`D1 新千歳空港 → ${to}`)
    await userEvent.click(await startButton())
    act(() => frames.onFrame(50))
    expect(screen.getByTestId('zone-status')).toHaveTextContent('次の鹿ゾーンまで')
  })

  it('AC-2: alert=off で開くと OFF（スマホの AlertState が無い）。付いていなければ ON', async () => {
    stubApi(ok)
    renderDrive(`/drive?trip=${TRIP_ID}&day=1&alert=off`)
    await userEvent.click(await startButton())
    expect(document.querySelector('[data-alert-state]')).toBeNull()
  })

  it('AC-2: alert が無ければ（plan.alertEnabled に関わらず）ON でスマホに AlertState', async () => {
    stubApi((day) => {
      const body = tripDayBody(day)
      return { status: 200, body: { ...body, plan: { ...body.plan, alertEnabled: false } } }
    })
    renderDrive(`/drive?trip=${TRIP_ID}&day=1`)
    await userEvent.click(await startButton())
    expect(document.querySelector('[data-alert-state]')).not.toBeNull()
  })
})

describe('入口（R1）', () => {
  it('UC-1a: trip が無ければ見本の場面（API を呼ばない）', async () => {
    const calls = stubApi(ok)
    renderDrive('/drive')
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('国道 240 号')
    expect(calls).toEqual([])
  })

  it.each(['', '&day=0', '&day=abc'])('UC-1b: day が「%s」→ 1 日目を読む', async (q) => {
    const calls = stubApi(ok)
    renderDrive(`/drive?trip=${TRIP_ID}${q}`)
    await startButton()
    expect(calls[0]).toMatch(/\/day\/1$/)
  })

  it('UC-1b: trip の形が違えば API を呼ばずに「旅が見つかりません」', async () => {
    const calls = stubApi(ok)
    renderDrive('/drive?trip=a!b')
    await expectMessage('旅が見つかりません')
    expect(calls).toEqual([])
  })
})

describe('読み込み（R2）', () => {
  it('UC-2a: 読み込み中は「旅を読み込んでいます」', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    )
    renderDrive(`/drive?trip=${TRIP_ID}&day=1`)
    await expectMessage('旅を読み込んでいます')
  })

  it.each([
    [404, 'TRIP_NOT_FOUND', '旅が見つかりません', '/plan', false],
    [404, 'DAY_NOT_FOUND', 'その日はありません', `/trip/${TRIP_ID}/brief?day=1`, false],
    [409, 'ITINERARY_CHANGED', 'この旅は古い形式です', '/plan', false],
    [429, 'RATE_LIMITED', '少し待ってからもう一度', `/trip/${TRIP_ID}/brief?day=6`, true],
  ] as const)('UC-2b: %i %s → 「%s」', async (status, code, text, href, retry) => {
    const calls = stubApi(() => fail(status, code))
    renderDrive(`/drive?trip=${TRIP_ID}&day=6`)
    await expectMessage(text)
    expect(screen.getAllByRole('link')[0]).toHaveAttribute('href', href)
    expect(screen.queryByRole('button', { name: 'もう一度' }) !== null).toBe(retry)
    // 4xx は読み直さない
    expect(calls).toHaveLength(1)
  })

  it('UC-2c: 500 は 1 回だけ読み直し、まだ失敗なら「読み込めませんでした」。「もう一度」で読み直せる', async () => {
    const calls = stubApi((day, n) => (n <= 2 ? fail(500, 'INTERNAL') : ok(day)))
    renderDrive(`/drive?trip=${TRIP_ID}&day=1`)
    await expectMessage('読み込めませんでした')
    expect(calls).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'ブリーフィングに戻る' })).toHaveAttribute(
      'href',
      `/trip/${TRIP_ID}/brief?day=1`,
    )
    await userEvent.click(screen.getByRole('button', { name: 'もう一度' }))
    await startButton()
  })

  it('UC-2c: 形の違う応答は読み直さずに「読み込めませんでした」', async () => {
    const calls = stubApi((day) => ({
      status: 200,
      body: { ...tripDayBody(day), day: { day: 'x' } },
    }))
    vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    renderDrive(`/drive?trip=${TRIP_ID}&day=1`)
    await expectMessage('読み込めませんでした')
    expect(calls).toHaveLength(1)
  })

  it('UC-2e: エラーの本文が { error: null } や JSON でなくても「読み込めませんでした」（例外で落ちない）', async () => {
    stubApi(() => ({ status: 503, body: { error: null } }))
    renderDrive(`/drive?trip=${TRIP_ID}&day=1`)
    await expectMessage('読み込めませんでした')
  })

  it('UC-2d: 移動の無い日は「この日は移動がありません」とその日の A-2 へ', async () => {
    stubApi((day) => {
      const body = tripDayBody(day)
      return {
        status: 200,
        body: { ...body, day: { ...body.day, legs: [], zones: [], stayAt: 'kushiro' } },
      }
    })
    renderDrive(`/drive?trip=${TRIP_ID}&day=3&alert=off`)
    await expectMessage('この日は移動がありません')
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      `/trip/${TRIP_ID}/brief?day=3&alert=off`,
    )
  })
})

describe('ゾーンの版（R5）', () => {
  it('UC-4e: API のゾーン DB の hash が同梱と違えば警告を残し、そのまま走る', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    stubApi((day) => {
      const body = tripDayBody(day)
      return {
        status: 200,
        body: { ...body, day: { ...body.day, data: { ...body.day.data, zones: '0'.repeat(64) } } },
      }
    })
    renderDrive(`/drive?trip=${TRIP_ID}&day=1`)
    await startButton()
    expect(warn).toHaveBeenCalledWith(
      'drive.zones.mismatch',
      expect.objectContaining({ api: '0'.repeat(64) }),
    )
  })
})

describe('出発の案内と結果（R7・R8）', () => {
  it('UC-5a: 案内に D1・地点の名前・距離・天候・路面。A-2 へのリンクはアラートの状態を引き継ぐ', async () => {
    stubApi(ok)
    renderDrive(`/drive?trip=${TRIP_ID}&day=1&alert=off`)
    await startButton()
    const leg = screen.getByTestId('start-leg')
    const day = tripDayBody(1).day
    const km = Math.round(day.legs.reduce((s, l) => s + l.distanceKm, 0))
    expect(leg).toHaveTextContent(`距離 ${String(km)} km`)
    expect(screen.getByRole('link', { name: 'ブリーフィングに戻る' })).toHaveAttribute(
      'href',
      `/trip/${TRIP_ID}/brief?day=1&alert=off`,
    )
  })

  it('UC-5b・UC-5c: 完走で DriveResult を渡し、帯に「ブリーフィングに戻る」。「同じシードでもう一度」は API を読み直さない', async () => {
    const calls = stubApi(ok)
    const results: DriveResult[] = []
    const frames = renderDrive(`/drive?trip=${TRIP_ID}&day=1`, (r) => results.push(r))
    await userEvent.click(await startButton())
    act(() => frames.onFrame(50))
    expect(results).toEqual([]) // 走っている間は結果を作らない
    // 終点の手前に置いて 1 フレーム進める（終点まで走りきるのは domain の受け入れテストで見た）
    const world = frames.world()
    if (!world) throw new Error('World がない')
    // 最後のステージの出口の手前に置く（その出口を抜けると完走。drive-tune R1）
    const stages = world.internal.stages
    world.internal.stageIndex = stages.length - 1
    world.vehicle = {
      ...world.vehicle,
      s: (stages[stages.length - 1]?.exitM ?? 0) - 1.5,
      speed: 20,
    }
    act(() => frames.onFrame(100))
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      tripId: TRIP_ID,
      day: 1,
      outcome: 'completed',
      alertEnabled: true,
    })
    expect(await screen.findByRole('heading', { name: '完走しました' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ブリーフィングに戻る' })).toHaveAttribute(
      'href',
      `/trip/${TRIP_ID}/brief?day=1`,
    )
    await userEvent.click(screen.getByRole('button', { name: '同じシードでもう一度' }))
    expect(frames.world()?.vehicle.s).toBe(frames.world()?.internal.stages[0]?.startM)
    expect(calls).toHaveLength(1)
    // 単独で約 1.5 秒。全 workspace を並列で回すと既定の 5 秒を超えることがある（sfad-done で 5.4 秒）
  }, 20_000)
})
