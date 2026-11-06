import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createTestQueryClient } from '@/test/render'
import { demoScenario } from '../domain/scenario'
import { ZONES } from '../domain/zones-data'
import type { DriveScenario } from '../types'
import { ChatDeckError, deckFits, parseChatResponse, shouldRetryChat } from './chat-api'
import { ChatFeedStore } from './chat-feed-store'
import { ChatFeed } from './ChatFeed'
import type { ChatDeck } from './chat-types'
import { useChatDeck, useChatTrack } from './use-chat-track'

// 会話の取得と表示（docs/specs/drive-audio-chat/functional.md R13・R18、CHAT-4g・CHAT-4h）。api は fetch のスタブ。

const TOKEN = 'a'.repeat(64)
const DEMO = demoScenario(ZONES)
const DATA = { routes: '2026-11-01', zones: 'abc123', conditions: 1 } as const
const TRIP: DriveScenario = { ...DEMO, source: 'trip', data: DATA }
const OWNER_KEY = `antler.trip-owner.${TRIP.trip.id}`
const ROUTE = { totalM: 60_000, zonesKm: [] as [number, number][] }

const L = (ja: string) => ({ ja, en: `${ja} en`, zh: `${ja} zh`, ko: `${ja} ko` })

function apiDeck(over: Partial<ChatDeck> = {}): ChatDeck {
  return {
    tripId: TRIP.trip.id,
    day: TRIP.day,
    lines: [
      {
        id: 'l01',
        cue: { kind: 'road', leg: 0, km: 0.2 },
        topic: 'depart',
        speaker: 'p1',
        pleasure: null,
        text: L('出発だね'),
      },
      {
        id: 'l02',
        cue: { kind: 'road', leg: 0, km: 16 },
        topic: 'scenery',
        speaker: 'p2',
        pleasure: null,
        text: L('景色'),
      },
    ],
    data: { routes: DATA.routes, zones: DATA.zones },
    ...over,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

function stubFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, init })
      return Promise.resolve(new Response(JSON.stringify(body), { status }))
    }),
  )
  return calls
}

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>
}

describe('useChatDeck・useChatTrack（R18・R19）', () => {
  it('CHAT-4g: トークンがあれば Authorization: Bearer つきで POST し、応答の形を確かめる', async () => {
    localStorage.setItem(OWNER_KEY, TOKEN)
    const calls = stubFetch(201, { chat: apiDeck() })
    const { result } = renderHook(() => useChatDeck(TRIP), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.lines).toHaveLength(2)
    expect(calls[0]?.url).toBe(`/api/trips/${TRIP.trip.id}/day/${String(TRIP.day)}/chat`)
    expect(calls[0]?.init.method).toBe('POST')
    expect(new Headers(calls[0]?.init.headers).get('Authorization')).toBe(`Bearer ${TOKEN}`)
  })

  it('CHAT-4g: トークンが無い・見本の運転では取りに行かない', () => {
    const calls = stubFetch(201, { chat: apiDeck() })
    renderHook(() => useChatDeck(TRIP), { wrapper })
    localStorage.setItem(OWNER_KEY, TOKEN)
    renderHook(() => useChatDeck(DEMO), { wrapper })
    expect(calls).toHaveLength(0)
  })

  it('CHAT-4g: 取れて版が合えば api の会話、取れない・版が違えば見本の会話', async () => {
    localStorage.setItem(OWNER_KEY, TOKEN)
    stubFetch(201, { chat: apiDeck() })
    const { result } = renderHook(() => useChatTrack(TRIP, ROUTE), { wrapper })
    // 届くまでは見本の会話
    expect(result.current.key).toContain('local')
    await waitFor(() => expect(result.current.key).not.toContain('local'))
    expect(result.current.road.map((r) => r.text.ja)).toEqual(['出発だね', '景色'])

    stubFetch(201, { chat: apiDeck({ data: { routes: 'old', zones: DATA.zones } }) })
    const stale = renderHook(() => useChatTrack(TRIP, ROUTE), { wrapper })
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
    expect(stale.result.current.key).toContain('local')
  })

  it('CHAT-4g: 形の違う応答は使わず、やり直すのは通信の失敗だけ', () => {
    expect(parseChatResponse({ chat: { ...apiDeck(), lines: [{ id: 'x' }] } })).toBeNull()
    expect(parseChatResponse(null)).toBeNull()
    expect(parseChatResponse({ chat: apiDeck() })?.lines).toHaveLength(2)
    expect(shouldRetryChat(0, new ChatDeckError(null, null))).toBe(true)
    expect(shouldRetryChat(1, new ChatDeckError(null, null))).toBe(false)
    expect(shouldRetryChat(0, new ChatDeckError(502, 'WRITER_FAILED'))).toBe(false)
    expect(shouldRetryChat(0, new ChatDeckError(503, 'WRITER_BUSY'))).toBe(false)
    expect(shouldRetryChat(0, new Error('x'))).toBe(false)
  })

  it('UC-3a・FAIL-62（drive-tourism）: pleasure は任意・null 可。マスターに無い id・楽しみ以外の話題の行の id は null', () => {
    const deck = apiDeck()
    const [a, b] = deck.lines
    const body = {
      chat: {
        ...deck,
        lines: [
          { ...b, topic: 'pleasure', pleasure: 'red-crowned-crane' },
          { ...b, id: 'l03', topic: 'pleasure', pleasure: 'no-such-pleasure' },
          { ...b, id: 'l04', topic: 'pleasure', pleasure: undefined },
          { ...a, id: 'l05', pleasure: 'red-crowned-crane' },
        ],
      },
    }
    expect(parseChatResponse(body)?.lines.map((l) => l.pleasure)).toEqual([
      'red-crowned-crane',
      null,
      null,
      null,
    ])
    // 欄の無い古い応答もそのまま使える
    const old = { chat: { ...deck, lines: deck.lines.map(({ pleasure: _, ...rest }) => rest) } }
    expect(parseChatResponse(old)?.lines.map((l) => l.pleasure)).toEqual([null, null])
  })

  it('CHAT-4g: 日・版・移動の数が合うときだけ使う', () => {
    const scene = { tripId: TRIP.trip.id, day: TRIP.day, data: DATA, legCount: 1 }
    expect(deckFits(apiDeck(), scene)).toBe(true)
    expect(deckFits(apiDeck({ day: TRIP.day + 1 }), scene)).toBe(false)
    expect(deckFits(apiDeck(), { ...scene, data: null })).toBe(false)
    expect(deckFits(apiDeck(), { ...scene, data: { ...DATA, zones: 'zz' } })).toBe(false)
    const far = apiDeck()
    far.lines = [{ ...far.lines[0]!, cue: { kind: 'road', leg: 1, km: 0.2 } }]
    expect(deckFits(far, scene)).toBe(false)
  })
})

describe('ChatFeed（R13）', () => {
  const line = (key: string, ja: string, pleasure: string | null = null) => ({
    key,
    speaker: 'p1' as const,
    pleasure,
    text: L(ja),
  })

  it('CHAT-4h・UC-3c: 新しい 3 行まで（drive-tourism T8）、新しいものを下に、話し手の名前と旅の言語の一言', () => {
    const feed = new ChatFeedStore()
    render(<ChatFeed feed={feed} lang="ja" dimmed={false} />)
    const log = screen.getByRole('log', { name: '車内の会話' })
    act(() => feed.push([line('a', 'いち'), line('b', 'に'), line('c', 'さん')]))
    act(() => feed.push([line('d', 'よん'), line('e', 'ご')]))
    const items = log.querySelectorAll('li')
    expect(items).toHaveLength(3)
    expect([...items].map((li) => li.querySelector('.drive-chat__text')?.textContent)).toEqual([
      'さん',
      'よん',
      'ご',
    ])
    expect(items[0]?.textContent).toContain('助手席')
  })

  it('UC-3c（drive-tourism T8）: 楽しみの行に写真（alt=""）と出典の平文（リンクなし）。ほかの行・記録の無い楽しみは写真なし。読み上げに出典を入れない', () => {
    const feed = new ChatFeedStore()
    const { container } = render(<ChatFeed feed={feed} lang="en" dimmed={false} />)
    act(() =>
      feed.push([
        line('a', 'weather'),
        line('b', 'no photo', 'unknown-pleasure'),
        line('c', 'drift ice', 'drift-ice-walk'),
      ]),
    )
    const items = container.querySelectorAll('li')
    expect(items[0]?.querySelector('img')).toBeNull()
    expect(items[1]?.querySelector('img')).toBeNull()
    const img = items[2]?.querySelector('img')
    expect(img).toHaveAttribute('src', expect.stringContaining('photos/drift-ice-walk.jpg'))
    expect(img).toHaveAttribute('alt', '')
    expect(items[2]?.querySelector('.drive-chat__credit')?.textContent).toBe(
      'Photo: kkawamura / CC BY 4.0',
    )
    expect(container.querySelectorAll('a, button, input, [tabindex]')).toHaveLength(0)
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(
      'Front passenger: drift ice en',
    )
  })

  it('CHAT-4h: 読み上げは見えない aria-live に最後の行だけ。一覧は aria-live=off', () => {
    const feed = new ChatFeedStore()
    const { container } = render(<ChatFeed feed={feed} lang="en" dimmed={false} />)
    act(() => feed.push([line('a', 'one'), line('b', 'two')]))
    const live = container.querySelector('[aria-live="polite"]')
    expect(live?.textContent).toBe('Front passenger: two en')
    expect(screen.getByRole('log', { name: 'In-car conversation' })).toHaveAttribute(
      'aria-live',
      'off',
    )
    // フォーカスを取る要素・操作要素が無い
    expect(container.querySelectorAll('button, a, input, [tabindex]')).toHaveLength(0)
  })

  it('CHAT-4h: 赤の間は減光の印。reset で消える', () => {
    const feed = new ChatFeedStore()
    const { container, rerender } = render(<ChatFeed feed={feed} lang="ko" dimmed={false} />)
    expect(container.firstElementChild).toHaveAttribute('data-dimmed', 'false')
    rerender(<ChatFeed feed={feed} lang="ko" dimmed />)
    expect(container.firstElementChild).toHaveAttribute('data-dimmed', 'true')
    act(() => feed.push([line('a', '하나')]))
    expect(screen.getByText('하나 ko')).toBeInTheDocument()
    act(() => feed.reset())
    expect(container.querySelectorAll('li')).toHaveLength(0)
  })
})
