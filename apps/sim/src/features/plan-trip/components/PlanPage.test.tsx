import {
  assessRisk,
  buildItinerary,
  buildTripPlan,
  PERSONA_INPUT,
  type TripInput,
} from '@antler/trip'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { renderWithProviders } from '@/test/render'
import { usePlanTripStore } from '../store'
import { PlanPage } from './PlanPage'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TRIP_ID = 'Ab3dE6gh'
const TITLES = {
  ja: '流氷とタンチョウの道東',
  en: 'Drift ice and cranes in eastern Hokkaido',
  zh: '流冰與丹頂鶴的道東',
  ko: '유빙과 두루미의 도동',
}

function createdResponse(input: TripInput) {
  const itinerary = buildItinerary(input)
  const plan = buildTripPlan(input, itinerary, assessRisk(input, itinerary), {
    id: TRIP_ID,
    seed: 42,
    title: TITLES[input.lang],
  })
  return {
    plan,
    details: {
      tripId: TRIP_ID,
      titles: TITLES,
      dayNotes: itinerary.days.map((d) => ({ day: d.day, note: TITLES })),
      skipped: itinerary.skipped,
      createdAt: '2026-11-03T09:00:00.000Z',
    },
    ownerToken: 'owner-token-for-test',
  }
}

type FetchCall = { url: string; key: string; body: TripInput }

function stubFetch(responses: { status: number; body: unknown }[]) {
  const calls: FetchCall[] = []
  const fetchMock = vi.fn((url: string, init: RequestInit) => {
    const headers = new Headers(init.headers)
    calls.push({
      url,
      key: headers.get('Idempotency-Key') ?? '',
      body: JSON.parse(String(init.body)) as TripInput,
    })
    const next = responses[Math.min(calls.length - 1, responses.length - 1)]
    if (!next) throw new Error('応答が無い')
    return Promise.resolve(
      new Response(JSON.stringify(next.body), {
        status: next.status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

function renderPlan() {
  const router = createMemoryRouter(
    [
      { path: '/plan', element: <PlanPage /> },
      // 移った先の A-2 は brief-map の feature（ここでは遷移だけを見る）
      { path: '/trip/:id/brief', element: <p>brief</p> },
    ],
    { initialEntries: ['/plan'] },
  )
  renderWithProviders(<RouterProvider router={router} />)
  return router
}

function daysText(): string[] {
  return screen.getAllByTestId('plan-day').map((li) => li.textContent ?? '')
}

const SUBMIT = { name: 'この旅を守りに行く →' }

describe('PlanPage（A-1 旅をつくる）', () => {
  beforeEach(() => {
    usePlanTripStore.getState().resetPlanTrip(['ja-JP'])
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('AC-2 ペルソナで開くと D1〜D5 と「高い」。楽しみを 1 つ外すとしおりが変わり、作成で /trip/:id/brief に移る', async () => {
    const user = userEvent.setup()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const router = renderPlan()

    expect(screen.getAllByTestId('plan-day').map((li) => li.textContent?.slice(0, 2))).toEqual([
      'D1',
      'D2',
      'D3',
      'D4',
      'D5',
    ])
    expect(screen.getByTestId('plan-risk-level')).toHaveTextContent('高い')
    expect(screen.getByText('重みは目安です。', { exact: false })).toBeInTheDocument()

    const before = daysText()
    const titleBefore = screen.getByTestId('plan-draft-title').textContent
    await user.click(screen.getByRole('button', { name: /^タンチョウ/ }))
    expect(daysText()).not.toEqual(before)
    expect(screen.getByTestId('plan-draft-title').textContent).not.toBe(titleBefore)

    const expectedInput: TripInput = {
      ...PERSONA_INPUT,
      lang: 'ja',
      // 重さは送らない（plan-trip-photos）
      pleasures: [{ id: 'drift-ice-walk' }, { id: 'akan-ainu-kotan' }],
    }
    const calls = stubFetch([{ status: 201, body: createdResponse(expectedInput) }])
    await user.click(screen.getByRole('button', SUBMIT))

    expect(await screen.findByText('brief')).toBeVisible()
    expect(router.state.location.state).toEqual({ titles: TITLES })
    expect(router.state.location.pathname).toBe(`/trip/${TRIP_ID}/brief`)
    // 所有者トークン（A-7 の削除の権利）は旅の id ごとに端末に残る（R7）
    expect(localStorage.getItem(`antler.trip-owner.${TRIP_ID}`)).toBe('owner-token-for-test')

    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call?.url).toMatch(/\/api\/trips$/)
    expect(call?.key).toMatch(UUID)
    expect(call?.body).toEqual(expectedInput)
    expect(call?.body.depart.at.endsWith('+09:00')).toBe(true)
    expect(sessionStorage.length).toBe(0)
  })

  it('PAC-1 ペルソナで開くと、カードに重さの操作が無く、写真のカードは写真と引用（出典へのリンク）を出し、右パネルに D1〜D5 と時間の配分が出る', () => {
    renderPlan()
    // 重さの操作・表示が無い（plan-trip-photos）
    expect(screen.queryByRole('group', { name: /重さ/ })).toBeNull()
    expect(screen.queryByText(/重さ/)).toBeNull()

    const ice = screen.getByRole('button', { name: /^流氷ウォーク/ }).closest('article')
    if (!ice) throw new Error('流氷ウォークのカードが無い')
    expect(ice.querySelector('img')).toHaveAttribute('alt', '')
    expect(within(ice).getByText(/約 3 時間/)).toBeInTheDocument()
    const source = within(ice).getByRole('link', { name: /流氷ウォーク の写真「.*」の出典/ })
    expect(source.getAttribute('href')).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/)
    expect(screen.getByText(/写真は Wikimedia Commons から/)).toBeInTheDocument()

    expect(screen.getAllByTestId('plan-day').map((li) => li.textContent?.slice(0, 2))).toEqual([
      'D1',
      'D2',
      'D3',
      'D4',
      'D5',
    ])
    expect(screen.getByText(/時間の配分（合計 約 6\.5 時間）/)).toBeInTheDocument()
  })

  it('R8 失敗すると入力を残して「もう一度」。もう一度は同じ冪等キーで送り直す', async () => {
    const user = userEvent.setup()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    renderPlan()
    const calls = stubFetch([
      { status: 502, body: { error: { code: 'WRITER_FAILED' } } },
      { status: 201, body: createdResponse({ ...PERSONA_INPUT, lang: 'ja' }) },
    ])

    await user.click(screen.getByRole('button', SUBMIT))
    const alert = await screen.findByText('しおりを仕上げられませんでした。', { exact: false })
    expect(alert).toBeInTheDocument()
    expect(screen.getByLabelText('人数')).toHaveValue(4)

    await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'もう一度' }))
    expect(await screen.findByText('brief')).toBeVisible()
    expect(calls).toHaveLength(2)
    expect(calls[1]?.key).toBe(calls[0]?.key)
    expect(calls[1]?.body).toEqual(calls[0]?.body)
  })

  it('R8 api につながらない（通信の失敗）ときは「サーバーにつながりません」と出し、「もう一度」で送り直せる', async () => {
    const user = userEvent.setup()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    renderPlan()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )
    await user.click(screen.getByRole('button', SUBMIT))
    expect(
      await screen.findByText('サーバーにつながりませんでした。', { exact: false }),
    ).toBeInTheDocument()
    expect(screen.queryByText('しおりを仕上げられませんでした。', { exact: false })).toBeNull()
    expect(
      within(screen.getByRole('alert')).getByRole('button', { name: 'もう一度' }),
    ).toBeEnabled()
  })

  it('R8 失敗のあとに入力を直してから「もう一度」を押すと、新しいキーと新しい入力で送る', async () => {
    const user = userEvent.setup()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    renderPlan()
    const calls = stubFetch([{ status: 502, body: { error: { code: 'WRITER_FAILED' } } }])
    await user.click(screen.getByRole('button', SUBMIT))
    await screen.findByText('しおりを仕上げられませんでした。', { exact: false })

    const size = screen.getByLabelText('人数')
    await user.clear(size)
    await user.type(size, '3')
    await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'もう一度' }))
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1]?.key).not.toBe(calls[0]?.key)
    expect(calls[1]?.body.party.size).toBe(3)
    expect(calls[0]?.body.party.size).toBe(4)
  })

  it('R8 主ボタンを押し直すと新しい冪等キーを作る', async () => {
    const user = userEvent.setup()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    renderPlan()
    const calls = stubFetch([{ status: 502, body: { error: { code: 'WRITER_FAILED' } } }])
    await user.click(screen.getByRole('button', SUBMIT))
    await screen.findByText('しおりを仕上げられませんでした。', { exact: false })
    await user.click(screen.getByRole('button', SUBMIT))
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1]?.key).not.toBe(calls[0]?.key)
  })

  it('R9 429 は「本日の生成上限に達しました」', async () => {
    const user = userEvent.setup()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    renderPlan()
    stubFetch([{ status: 429, body: { error: { code: 'DAILY_LIMIT' } } }])
    await user.click(screen.getByRole('button', SUBMIT))
    expect(await screen.findByText('本日の生成上限に達しました。')).toBeInTheDocument()
  })

  it('UC-1 運転できる人が人数より多いとエラーを出し、しおりは前の値のまま。api は呼ばない', async () => {
    const user = userEvent.setup()
    renderPlan()
    const calls = stubFetch([{ status: 201, body: {} }])
    const before = daysText()
    const drivers = screen.getByLabelText('運転できる人')
    await user.clear(drivers)
    await user.type(drivers, '5')

    expect(drivers).toHaveAttribute('aria-invalid', 'true')
    expect(
      screen.getByText('運転できる人は 1 人以上、人数以下にしてください。'),
    ).toBeInTheDocument()
    expect(daysText()).toEqual(before)

    await user.click(screen.getByRole('button', SUBMIT))
    expect(calls).toHaveLength(0)
  })

  it('UC-1 入力が不正なあいだも、楽しみの変更はしおりに反映する（最後に通った入力の値で作る）', async () => {
    const user = userEvent.setup()
    renderPlan()
    const drivers = screen.getByLabelText('運転できる人')
    await user.clear(drivers)
    await user.type(drivers, '5')
    const before = daysText()
    await user.click(screen.getByRole('button', { name: /^タンチョウ/ }))
    expect(daysText()).not.toEqual(before)
    expect(daysText()).toHaveLength(5)
  })

  it('UC-1 出発・返却の欄は「日本時間」と書き、日程を変えるとしおりの日数が変わる', async () => {
    const user = userEvent.setup()
    renderPlan()
    const ret = screen.getByLabelText('返却・帰国（日本時間）')
    expect(screen.getByLabelText('出発（日本時間）')).toHaveValue('2027-02-14T10:00')
    await user.clear(ret)
    await user.type(ret, '2027-02-16T17:00')
    expect(screen.getAllByTestId('plan-day')).toHaveLength(3)
  })

  it('UC-6a 初期言語はブラウザの言語（zh-TW → 繁體中文）。切り替えると文言が変わる', async () => {
    const user = userEvent.setup()
    usePlanTripStore.getState().resetPlanTrip(['zh-TW', 'en-US'])
    renderPlan()
    expect(screen.getByLabelText('語言')).toHaveValue('zh')
    expect(screen.getByRole('button', { name: '去守護這趟旅程 →' })).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('語言'), 'ko')
    expect(screen.getByRole('button', { name: '이 여행을 지키러 가기 →' })).toBeInTheDocument()
    expect(screen.getByTestId('plan-risk-level')).toHaveTextContent('높음')
  })

  it('UC-6a ブラウザの言語が fr なら日本語', () => {
    usePlanTripStore.getState().resetPlanTrip(['fr-FR'])
    renderPlan()
    expect(screen.getByLabelText('言語')).toHaveValue('ja')
  })
})
