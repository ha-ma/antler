import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { renderWithProviders } from '@/test/render'
import { personaZoneDay, TRIP_ID, tripDayBody } from '@/test/trip-day'
import { BriefPage } from './BriefPage'

// A-2 の画面（docs/specs/brief-map/functional.md AC-2・UC-6〜UC-9、resilience.md FAIL-1・FAIL-4・FAIL-5）。
// api は fetch のスタブ。jsdom には WebGL が無いので、地図は背景なしの SVG で出る（本線の縮退）。

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

type Reply = { status: number; body: unknown }

function stubApi(reply: (day: number) => Reply) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      calls.push(url)
      const day = Number(/\/day\/(\d+)/.exec(url)?.[1] ?? 0)
      const r = reply(day)
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

const ok = (day: number, lang: 'ja' | 'en' | 'zh' | 'ko' = 'ja'): Reply => ({
  status: 200,
  body: tripDayBody(day, lang),
})
const fail = (status: number, code: string): Reply => ({
  status,
  body: { error: { code, message: 'x' } },
})

function renderBrief(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/trip/:id/brief', element: <BriefPage /> },
      { path: '/plan', element: <p>plan</p> },
    ],
    { initialEntries: [path] },
  )
  renderWithProviders(<RouterProvider router={router} />)
  return router
}

const heading = () =>
  screen.findByRole('heading', { level: 1, name: '今日のルートと、鹿の多い区間' })

describe('BriefPage（A-2）', () => {
  it('AC-2 / UC-8a: 要約・ゾーン通過・条件・凡例 3 つ・操作説明が出て、OFF にすると行き先に alert=off が付く', async () => {
    const zoneDay = personaZoneDay()
    stubApi((d) => ok(d))
    const router = renderBrief(`/trip/${TRIP_ID}/brief?day=${String(zoneDay)}`)
    await heading()
    expect(
      screen.getByText(new RegExp(`DAY ${String(zoneDay)} ・ .+ → .+ ・ \\d+(\\.\\d)? km`)),
    ).toBeInTheDocument()
    const passages = screen.getByRole('region', { name: '鹿ゾーンを通る予定' })
    expect(within(passages).getAllByRole('listitem').length).toBeGreaterThan(0)
    expect(screen.getByRole('region', { name: '今日の条件' })).toHaveTextContent(
      /コンパクト SUV 4WD/,
    )
    expect(screen.getByText('緑・円')).toBeInTheDocument()
    expect(screen.getByText('琥珀・三角')).toBeInTheDocument()
    expect(screen.getByText('赤・八角')).toBeInTheDocument()
    expect(screen.getByText('W A S D で運転')).toBeInTheDocument()

    const start = screen.getByRole('link', { name: 'エンジンをかける' })
    expect(start).toHaveAttribute('href', `/drive?trip=${TRIP_ID}&day=${String(zoneDay)}`)
    const toggle = screen.getByRole('switch', { name: '鹿アラート' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(router.state.location.search).toContain('alert=off')
    expect(start).toHaveAttribute('href', `/drive?trip=${TRIP_ID}&day=${String(zoneDay)}&alert=off`)
  })

  it('BRAND-3: ヘッダーに SHIKASHI SIMULATOR のロゴ（昼の版）、title の末尾も SHIKASHI SIMULATOR', async () => {
    stubApi((d) => ok(d))
    renderBrief(`/trip/${TRIP_ID}/brief?day=1`)
    await heading()
    const logo = screen.getByRole('img', { name: 'SHIKASHI SIMULATOR' })
    expect(logo).toHaveAttribute('src', '/brand/shikashi-logo.png')
    await waitFor(() => {
      expect(document.title).toMatch(/ \| SHIKASHI SIMULATOR$/)
    })
  })

  it('UC-6a: ?day=2 で DAY 2、?day=x は DAY 1。DAY 1〜5 の切り替えはリンク', async () => {
    const calls = stubApi((d) => ok(d))
    renderBrief(`/trip/${TRIP_ID}/brief?day=x`)
    await heading()
    expect(calls[0]).toMatch(new RegExp(`/api/trips/${TRIP_ID}/day/1$`))
    const nav = screen.getByRole('navigation', { name: '日にち' })
    const links = within(nav).getAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual(['DAY 1', 'DAY 2', 'DAY 3', 'DAY 4', 'DAY 5'])
    expect(links[0]).toHaveAttribute('aria-current', 'page')
    await userEvent.click(links[1] as HTMLElement)
    await waitFor(() => expect(calls.at(-1)).toMatch(/\/day\/2$/))
  })

  it('UC-6b: 404 → 「旅が見つかりません」と A-1 へのリンク。日が無い → DAY 1 へ', async () => {
    stubApi(() => fail(404, 'TRIP_NOT_FOUND'))
    renderBrief(`/trip/Zz9yXx8w/brief`)
    expect(await screen.findByRole('heading', { name: '旅が見つかりません。' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '旅をつくる画面へ' })).toHaveAttribute('href', '/plan')
  })

  it('UC-6b: 日が無い（DAY_NOT_FOUND）→ DAY 1 へのリンク。409 → 古い形式', async () => {
    stubApi((d) => (d === 9 ? fail(404, 'DAY_NOT_FOUND') : fail(409, 'ITINERARY_CHANGED')))
    renderBrief(`/trip/${TRIP_ID}/brief?day=9`)
    expect(await screen.findByRole('heading', { name: 'その日はありません。' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'DAY 1 へ' })).toHaveAttribute(
      'href',
      `/trip/${TRIP_ID}/brief?day=1`,
    )
  })

  it('UC-6b / FAIL-4: 500 → 「もう一度」で読み直して成功すれば画面が出る', async () => {
    let failing = true
    stubApi((d) => (failing ? fail(500, 'INTERNAL_ERROR') : ok(d)))
    renderBrief(`/trip/${TRIP_ID}/brief`)
    // 5xx は 1 回だけ 0.5 秒あけて再試行してから失敗を出す
    expect(
      await screen.findByRole('heading', { name: '読み込めませんでした。' }, { timeout: 3000 }),
    ).toBeInTheDocument()
    failing = false
    await userEvent.click(screen.getByRole('button', { name: 'もう一度' }))
    expect(await heading()).toBeInTheDocument()
  })

  it('FAIL-5: 応答の形が違う → 失敗の表示（白い画面にならない）', async () => {
    stubApi(() => ({ status: 200, body: { plan: {}, day: null } }))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    renderBrief(`/trip/${TRIP_ID}/brief`)
    expect(
      await screen.findByRole('heading', { name: '読み込めませんでした。' }, { timeout: 3000 }),
    ).toBeInTheDocument()
  })

  it('UC-6c: 言語は plan.lang（zh は繁体字）', async () => {
    stubApi((d) => ok(d, 'zh'))
    renderBrief(`/trip/${TRIP_ID}/brief`)
    expect(
      await screen.findByRole('heading', { level: 1, name: '今天的路線，以及鹿常出沒的路段' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: '鹿警示' })).toBeInTheDocument()
  })

  it('UC-7a: ?alert=off で開くと OFF、押すと ON に戻り URL から alert が消える', async () => {
    stubApi((d) => ok(d))
    const router = renderBrief(`/trip/${TRIP_ID}/brief?day=1&alert=off`)
    await heading()
    const toggle = screen.getByRole('switch', { name: '鹿アラート' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText(/いまは OFF です/)).toBeInTheDocument()
    await userEvent.click(toggle)
    expect(router.state.location.search).not.toContain('alert')
  })

  it('UC-7b: 凡例は AlertState の safe・zone・danger（compact）で、読み上げからは外す', async () => {
    stubApi((d) => ok(d))
    const { container } = { container: document.body }
    renderBrief(`/trip/${TRIP_ID}/brief`)
    await heading()
    const phones = container.querySelectorAll('.brief-legend__phone')
    expect(phones).toHaveLength(3)
    for (const phone of phones) expect(phone).toHaveAttribute('aria-hidden', 'true')
  })

  it('UC-9a / FAIL-1 / UC-9b: 背景を出せない環境では注記と SVG（帯は区間の数）。帰属表示と OSM の著作権リンクがある', async () => {
    const zoneDay = personaZoneDay()
    const body = tripDayBody(zoneDay)
    stubApi((d) => ok(d))
    renderBrief(`/trip/${TRIP_ID}/brief?day=${String(zoneDay)}`)
    await heading()
    expect(await screen.findByText(/地図の背景を読み込めません/)).toBeInTheDocument()
    const map = screen.getByRole('img', { name: /ルートの地図/ })
    expect(map).toHaveAttribute('data-mode', 'fallback')
    expect(within(map).getByTestId('zone-bands').querySelectorAll('path')).toHaveLength(
      body.day.zones.length,
    )
    expect(
      screen.getByText(/ルート: OSRM（© OpenStreetMap contributors, ODbL）/),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '著作権と利用条件' })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/copyright',
    )
  })

  it('UC-6d / UC-8b: 移動の無い日は「この日は運転しません」と滞在地、開始の代わりに次の日へ。最終日は出さない', async () => {
    const idle = (d: number): Reply => {
      const body = tripDayBody(d)
      return {
        status: 200,
        body: { ...body, day: { ...body.day, legs: [], zones: [], stayAt: 'kushiro' } },
      }
    }
    stubApi(idle)
    renderBrief(`/trip/${TRIP_ID}/brief?day=2&alert=off`)
    await heading()
    expect(screen.getByText('この日は運転しません（釧路で過ごします）。')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'エンジンをかける' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '次の日（DAY 3）へ' })).toHaveAttribute(
      'href',
      `/trip/${TRIP_ID}/brief?day=3&alert=off`,
    )
  })

  it('UC-8b: 移動の無い最終日は次の日へのリンクを出さない', async () => {
    stubApi((d) => {
      const body = tripDayBody(d)
      return {
        status: 200,
        body: { ...body, day: { ...body.day, legs: [], zones: [], stayAt: 'kushiro' } },
      }
    })
    renderBrief(`/trip/${TRIP_ID}/brief?day=5`)
    await heading()
    expect(screen.queryByRole('link', { name: /次の日/ })).not.toBeInTheDocument()
  })

  it('UC-8c: PC とスマホの操作説明が両方ある', async () => {
    stubApi((d) => ok(d))
    renderBrief(`/trip/${TRIP_ID}/brief`)
    await heading()
    for (const text of [
      'Space でブレーキ',
      'クリックで鹿を指す・ドラッグで囲む',
      '左の円をドラッグでハンドルと加減速',
      '右の円でブレーキ',
      'タップで鹿を指す',
    ])
      expect(screen.getByText(text)).toBeInTheDocument()
  })

  it('UC-9c: 地図の aria-label にゾーンの道路名と通過の時刻', async () => {
    const zoneDay = personaZoneDay()
    const first = tripDayBody(zoneDay).day.zones[0]
    stubApi((d) => ok(d))
    renderBrief(`/trip/${TRIP_ID}/brief?day=${String(zoneDay)}`)
    await heading()
    const map = await screen.findByRole('img', { name: /ルートの地図/ })
    expect(map.getAttribute('aria-label')).toContain(first?.roadName.ja ?? '?')
    expect(map.getAttribute('aria-label')).toMatch(/\d{1,2}:\d\d 〜 \d{1,2}:\d\d|\d{1,2}:\d\d〜/)
  })
})
