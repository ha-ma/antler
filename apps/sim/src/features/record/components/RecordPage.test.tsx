import { RECORD_TEXT } from '@antler/trip'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { renderWithProviders } from '@/test/render'
import { OWNER_TOKEN, personaRecord, run, TRIP_ID } from '../test-fixtures'
import type { RecordData } from '../types'
import { RecordPage } from './RecordPage'

// A-7 の画面（docs/specs/record/functional.md AC-2・UC-8・UC-9、resilience.md FAIL-3〜FAIL-5）。api は fetch のスタブ。

const OWNER_KEY = `antler.trip-owner.${TRIP_ID}`

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  localStorage.clear()
})

type Reply = { status: number; body?: unknown; bytes?: Uint8Array<ArrayBuffer> }
type Call = { url: string; method: string; headers: Record<string, string> }

function stubApi(reply: (call: Call) => Reply) {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const call = {
        url,
        method: init.method ?? 'GET',
        headers: (init.headers ?? {}) as Record<string, string>,
      }
      calls.push(call)
      const r = reply(call)
      if (r.bytes) return Promise.resolve(new Response(r.bytes, { status: r.status }))
      return Promise.resolve(
        new Response(r.body === undefined ? null : JSON.stringify(r.body), {
          status: r.status,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }),
  )
  return calls
}

const recordReply = (data: RecordData): Reply => ({ status: 200, body: data })
const fail = (status: number, code: string): Reply => ({
  status,
  body: { error: { code, message: 'x' } },
})

function renderRecord(path = `/t/${TRIP_ID}`) {
  const router = createMemoryRouter(
    [
      { path: '/t/:id', element: <RecordPage /> },
      { path: '/plan', element: <p>plan</p> },
      { path: '/trip/:id/brief', element: <p>brief</p> },
    ],
    { initialEntries: [path] },
  )
  renderWithProviders(<RouterProvider router={router} />)
  return router
}

const DONE = personaRecord([
  run({ day: 1 }),
  run({
    day: 2,
    encounters: [
      {
        pattern: 'roadside',
        at: '2027-02-15T16:31:00+09:00',
        alertToBrakeMs: 1200,
        closestM: 3,
        outcome: 'avoided',
      },
      {
        pattern: 'crossing',
        at: '2027-02-15T16:44:00+09:00',
        alertToBrakeMs: 1600,
        closestM: 25,
        outcome: 'avoided',
      },
    ],
  }),
])

describe('RecordPage（A-7）', () => {
  it('AC-2: 見出し・StatTile 4 つ・守れたもの・ログ・しおり・B の導線・挑戦が出て、削除を確かめて送ると「削除しました」になりトークンが消える', async () => {
    localStorage.setItem(OWNER_KEY, OWNER_TOKEN)
    const calls = stubApi((c) => (c.method === 'DELETE' ? { status: 204 } : recordReply(DONE)))
    const user = userEvent.setup()
    renderRecord()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'D2 まで走った。' }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('definition')).toHaveLength(4)
    expect(screen.getByText('楽しみ 達成')).toBeInTheDocument()
    expect(screen.getByText('鹿ゾーン通過')).toBeInTheDocument()
    expect(screen.getByText('鹿 遭遇 / 回避')).toBeInTheDocument()
    expect(screen.getByText('アラート→ブレーキ 平均')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '守れたもの' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '鹿ゾーンでの2回' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '旅のしおり' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '実際の旅にも、同じアラートを' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'アラート OFF で挑戦' })).toHaveAttribute(
      'href',
      `/trip/${TRIP_ID}/brief?day=2&alert=off`,
    )

    await user.click(screen.getByRole('button', { name: 'この記録を削除' }))
    // 確認の文にフォーカスが移る（WCAG 2.4.3）
    expect(screen.getByText(/共有先に表示されたカードは残ることがあります/)).toHaveFocus()
    await user.click(screen.getByRole('button', { name: '削除する' }))
    expect(await screen.findByRole('heading', { name: '削除しました。' })).toBeInTheDocument()
    expect(localStorage.getItem(OWNER_KEY)).toBeNull()
    const del = calls.find((c) => c.method === 'DELETE')
    expect(del?.url).toContain(`/api/trips/${TRIP_ID}`)
    expect(del?.headers['Authorization']).toBe(`Bearer ${OWNER_TOKEN}`)
  })

  it('UC-8a: 読み込み中・404（見つかりません）', async () => {
    stubApi(() => fail(404, 'TRIP_NOT_FOUND'))
    renderRecord()
    expect(screen.getByRole('status')).toHaveTextContent('記録を読み込んでいます')
    expect(
      await screen.findByRole('heading', { name: /この記録は見つかりません/ }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'もう一度' })).toBeNull()
    expect(screen.getByRole('link', { name: '自分の旅をつくる' })).toHaveAttribute('href', '/plan')
  })

  it('UC-8a / FAIL-3: 500 は「もう一度」で読み直して出る。形の違う応答は失敗の表示', async () => {
    let fails = true
    stubApi(() => (fails ? fail(500, 'INTERNAL_ERROR') : recordReply(DONE)))
    const user = userEvent.setup()
    renderRecord()
    // 5xx は 1 回だけ自動で読み直す
    await screen.findByRole('heading', { name: '読み込めませんでした。' }, { timeout: 3000 })
    fails = false
    await user.click(screen.getByRole('button', { name: 'もう一度' }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'D2 まで走った。' }),
    ).toBeInTheDocument()
  })

  it('FAIL-3: 形の違う応答 → 「読み込めませんでした」（白い画面にならない）', async () => {
    stubApi(() => ({ status: 200, body: { trip: { id: TRIP_ID }, record: {} } }))
    renderRecord()
    expect(
      await screen.findByRole('heading', { name: '読み込めませんでした。' }),
    ).toBeInTheDocument()
  })

  it('UC-8b: 完走・未走行の見出し、平均が無ければ「—」', async () => {
    stubApi(() => recordReply(personaRecord([])))
    renderRecord()
    expect(
      await screen.findByRole('heading', { level: 1, name: 'まだ走っていません。' }),
    ).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('UC-8b: 全日完走で「守りきった。」', async () => {
    const days = personaRecord([]).trip.days.map((d) => run({ day: d.day }))
    stubApi(() => recordReply(personaRecord(days)))
    renderRecord()
    expect(
      await screen.findByRole('heading', { level: 1, name: '守りきった。' }),
    ).toBeInTheDocument()
  })

  it('UC-8c: 守れたもの・ゾーンのログ（間一髪）と空の案内', async () => {
    stubApi(() => recordReply(DONE))
    renderRecord()
    const log = await screen.findByRole('region', { name: '鹿ゾーンでの2回' })
    const items = within(log).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('間一髪')
    expect(items[1]).toHaveTextContent('回避')
    expect(items[0]).toHaveTextContent('16:31')
    const kept = screen.getByRole('region', { name: '守れたもの' })
    expect(within(kept).getAllByRole('listitem').length).toBeGreaterThan(0)
  })

  it('UC-8c: 守れた楽しみ・遭遇が無ければ空の案内', async () => {
    stubApi(() => recordReply(personaRecord([])))
    renderRecord()
    expect(await screen.findByText('まだ守れた楽しみはありません。')).toBeInTheDocument()
    expect(screen.getByText('鹿には出会いませんでした。')).toBeInTheDocument()
  })

  it('UC-8d: しおりの各日に完走・衝突・未走行と OFF の印', async () => {
    stubApi(() =>
      recordReply(
        personaRecord([
          run({ day: 1 }),
          run({ day: 1, alertEnabled: false, outcome: 'collided' }),
          run({ day: 2, alertEnabled: false, outcome: 'collided' }),
        ]),
      ),
    )
    renderRecord()
    const shiori = await screen.findByRole('region', { name: '旅のしおり' })
    const rows = within(shiori).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('完走')
    expect(rows[0]).toHaveTextContent('OFF 衝突')
    expect(rows[1]).toHaveTextContent('衝突')
    expect(rows[1]).toHaveTextContent('アラート OFF')
    expect(rows[2]).toHaveTextContent('未走行')
  })

  it('UC-8e: B の導線は PWA、「別の旅をつくる」は /plan', async () => {
    vi.stubEnv('VITE_PWA_URL', 'https://b.ezoroad.example')
    stubApi(() => recordReply(DONE))
    renderRecord()
    expect(await screen.findByRole('link', { name: /車載アラートについて/ })).toHaveAttribute(
      'href',
      'https://b.ezoroad.example',
    )
    expect(screen.getByRole('link', { name: '別の旅をつくる' })).toHaveAttribute('href', '/plan')
  })

  it('UC-8f: 言語は旅の lang（en）。4 言語の文言の表に空欄が無い', async () => {
    stubApi(() => recordReply(personaRecord([], 'en')))
    renderRecord()
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Not driven yet.' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Pleasures kept')).toBeInTheDocument()
    for (const text of Object.values(RECORD_TEXT)) {
      for (const lang of ['ja', 'en', 'zh', 'ko'] as const) expect(text[lang].trim()).not.toBe('')
    }
  })

  it('UC-8g: 所有者トークンの無い端末では、挑戦の下に案内と、削除の代わりの案内', async () => {
    stubApi(() => recordReply(DONE))
    renderRecord()
    expect(
      await screen.findByText('この端末での運転は、この記録には残りません。'),
    ).toBeInTheDocument()
    expect(screen.getByText(/この旅をつくった端末（同じブラウザ）からできます/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'この記録を削除' })).toBeNull()
  })
})

describe('A-7 の操作', () => {
  it('UC-9a: 記録 URL は VITE_API_BASE_URL + /t/{id}。コピーで「コピーしました」', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.ezoroad.example/')
    stubApi(() => recordReply(DONE))
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    renderRecord()
    const input = await screen.findByRole('textbox', { name: 'この旅の URL' })
    expect(input).toHaveValue(`https://api.ezoroad.example/t/${TRIP_ID}`)
    await user.click(screen.getByRole('button', { name: 'リンクをコピー' }))
    expect(writeText).toHaveBeenCalledWith(`https://api.ezoroad.example/t/${TRIP_ID}`)
    expect(await screen.findByText('コピーしました')).toBeInTheDocument()
  })

  it('FAIL-5: clipboard が使えない → 「コピーできませんでした」', async () => {
    stubApi(() => recordReply(DONE))
    const user = userEvent.setup()
    renderRecord()
    await screen.findByRole('button', { name: 'リンクをコピー' })
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    await user.click(screen.getByRole('button', { name: 'リンクをコピー' }))
    expect(await screen.findByText(/コピーできませんでした/)).toBeInTheDocument()
  })

  it('UC-9b: 「しおりを画像で保存」で og.png を取り ezo-road-{id}.png で保存。失敗は案内', async () => {
    let imageOk = true
    const calls = stubApi((c) =>
      c.url.endsWith('/og.png')
        ? imageOk
          ? { status: 200, bytes: new Uint8Array([137, 80]) }
          : fail(503, 'OG_BUSY')
        : recordReply(DONE),
    )
    URL.createObjectURL = vi.fn(() => 'blob:png')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.download).toBe(`ezo-road-${TRIP_ID}.png`)
    })
    const user = userEvent.setup()
    renderRecord()
    await user.click(await screen.findByRole('button', { name: 'しおりを画像で保存' }))
    await waitFor(() => {
      expect(click).toHaveBeenCalledTimes(1)
    })
    expect(calls.some((c) => c.url.endsWith(`/t/${TRIP_ID}/og.png`))).toBe(true)
    imageOk = false
    await user.click(screen.getByRole('button', { name: 'しおりを画像で保存' }))
    expect(await screen.findByText(/画像を作れませんでした/)).toBeInTheDocument()
  })

  it('UC-9c: 確かめずに消えない（「やめる」で戻り、DELETE を送らない）', async () => {
    localStorage.setItem(OWNER_KEY, OWNER_TOKEN)
    const calls = stubApi(() => recordReply(DONE))
    const user = userEvent.setup()
    renderRecord()
    await user.click(await screen.findByRole('button', { name: 'この記録を削除' }))
    await user.click(screen.getByRole('button', { name: 'やめる' }))
    expect(screen.queryByRole('button', { name: '削除する' })).toBeNull()
    expect(screen.getByRole('button', { name: 'この記録を削除' })).toHaveFocus()
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
  })

  it('UC-9d: 403 は「この端末の鍵では削除できません」、トークンは残る', async () => {
    localStorage.setItem(OWNER_KEY, OWNER_TOKEN)
    stubApi((c) => (c.method === 'DELETE' ? fail(403, 'NOT_OWNER') : recordReply(DONE)))
    const user = userEvent.setup()
    renderRecord()
    await user.click(await screen.findByRole('button', { name: 'この記録を削除' }))
    await user.click(screen.getByRole('button', { name: '削除する' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('この端末の鍵では削除できません')
    expect(localStorage.getItem(OWNER_KEY)).toBe(OWNER_TOKEN)
  })

  it('UC-9d / FAIL-4: 通信の失敗は「つながりません」、トークンは残る', async () => {
    localStorage.setItem(OWNER_KEY, OWNER_TOKEN)
    stubApi(() => recordReply(DONE))
    const user = userEvent.setup()
    renderRecord()
    await user.click(await screen.findByRole('button', { name: 'この記録を削除' }))
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    )
    await user.click(screen.getByRole('button', { name: '削除する' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('つながりません')
    expect(localStorage.getItem(OWNER_KEY)).toBe(OWNER_TOKEN)
  })
})
