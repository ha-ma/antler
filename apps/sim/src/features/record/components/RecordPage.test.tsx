import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RECORD_TEXT } from '@antler/trip'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { OWNER_TOKEN, personaRecord, run, TRIP_ID } from '../test-fixtures'
import { RECORD_CLEAR_TEXT } from '../text'
import type { RecordData } from '../types'
import { RecordPage } from './RecordPage'

// vitest は CSS を空にして読む（?raw でも）ので、ファイルを直に読む
const recordCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'record.css'), 'utf8')

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

  it('BRAND-3: ヘッダーに SHIKASHI SIMULATOR のロゴ（昼の版）', async () => {
    stubApi(() => recordReply(DONE))
    renderRecord()
    const logo = await screen.findByRole('img', { name: 'SHIKASHI SIMULATOR' })
    expect(logo).toHaveAttribute('src', '/brand/shikashi-logo.png')
  })

  it('UC-9b・BRAND-7: 「しおりを画像で保存」で og.png を取り shikashi-{id}.png で保存。失敗は案内', async () => {
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
      expect(this.download).toBe(`shikashi-${TRIP_ID}.png`)
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

// 「クリア」の祝い（docs/specs/result-screens/functional.md R3・R4、UC-3・UC-4・S-1・S-2）
describe('A-7 の「クリア」', () => {
  // 上の describe の画面も祝いを出し、その履歴（MemoryRouter の最初の key は default）を覚えている
  beforeEach(() => {
    sessionStorage.clear()
  })

  const CLEARED = personaRecord([run({ day: 1 }), run({ day: 2 })])
  // ON で完走した D2 に、OFF で挑戦して衝突した（その日の結果は ON の完走のまま）
  const OFF_CRASHED = personaRecord([
    run({ day: 1 }),
    run({ day: 2 }),
    run({ day: 2, alertEnabled: false, outcome: 'collided' }),
  ])
  const h1 = () => screen.findByRole('heading', { level: 1, name: 'D2 まで走った。' })
  const confetti = () => document.querySelectorAll('.record-confetti')
  const clearBlock = (el: HTMLElement) => el.closest('.record-clear__text')

  function renderAt(entry: { pathname: string; state?: unknown; key?: string }) {
    const router = createMemoryRouter(
      [
        { path: '/t/:id', element: <RecordPage /> },
        { path: '/plan', element: <p>plan</p> },
      ],
      { initialEntries: [entry] },
    )
    return renderWithProviders(<RouterProvider router={router} />)
  }

  it('CLEAR-4 完走のあと: 「クリア」と説明が出て、フォーカスは「クリア」。円・紙吹雪は aria-hidden', async () => {
    stubApi(() => recordReply(CLEARED))
    renderAt({ pathname: `/t/${TRIP_ID}` })
    await h1()
    // フォーカスは「クリア」と説明の塊（読み上げが両方を読む）。見出しではない
    const block = clearBlock(screen.getByText('クリア'))
    expect(block).toHaveFocus()
    expect(block).toHaveTextContent('クリアD2 を、鹿にぶつからずに走りきりました。')
    expect(within(block as HTMLElement).queryByRole('heading')).toBeNull()
    expect(document.querySelector('.record-clear__mark')).toHaveAttribute('aria-hidden', 'true')
    expect(document.querySelector('.record-clear__confetti')).toHaveAttribute('aria-hidden', 'true')
    expect(confetti()).toHaveLength(24)
    // 読み上げの順: 「クリア」→ 記録の見出し
    const banner = document.querySelector('.record-clear')
    const heading = screen.getByRole('heading', { level: 1 })
    expect(
      banner && banner.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('CLEAR-4 4 言語: en の旅は CLEAR と英語の説明', async () => {
    stubApi(() => recordReply(personaRecord([run({ day: 1 })], 'en')))
    renderAt({ pathname: `/t/${TRIP_ID}` })
    expect(clearBlock(await screen.findByText('CLEAR'))).toHaveFocus()
    expect(screen.getByText('You drove Day 1 without hitting a deer.')).toBeInTheDocument()
  })

  it('CLEAR-5 A-6 から（衝突のあとの合図つき）: 「クリア」・円・紙吹雪が無く、フォーカスは見出し', async () => {
    stubApi(() => recordReply(OFF_CRASHED))
    renderAt({ pathname: `/t/${TRIP_ID}`, state: { arrival: 'after-collision' } })
    const heading = await h1()
    expect(heading).toHaveFocus()
    expect(screen.queryByText('クリア')).toBeNull()
    expect(document.querySelector('.record-clear')).toBeNull()
    expect(confetti()).toHaveLength(0)
  })

  it('S-1 最後の日が衝突 → 合図が無くても祝いを出さない', async () => {
    stubApi(() =>
      recordReply(personaRecord([run({ day: 1 }), run({ day: 2, outcome: 'collided' })])),
    )
    renderAt({ pathname: `/t/${TRIP_ID}` })
    expect(await h1()).toHaveFocus()
    expect(document.querySelector('.record-clear')).toBeNull()
  })

  it('ONCE-1 祝いを出した履歴に戻る・再読み込みでは出さない。別の履歴なら出す', async () => {
    stubApi(() => recordReply(CLEARED))
    const first = renderAt({ pathname: `/t/${TRIP_ID}`, key: 'entry-a' })
    expect(clearBlock(await screen.findByText('クリア'))).toHaveFocus()
    first.unmount()

    // 同じ履歴（戻る・再読み込み）
    const again = renderAt({ pathname: `/t/${TRIP_ID}`, key: 'entry-a' })
    expect(await h1()).toHaveFocus()
    expect(document.querySelector('.record-clear')).toBeNull()
    again.unmount()

    // 別の履歴（新しく走りきって移ってきた）
    renderAt({ pathname: `/t/${TRIP_ID}`, key: 'entry-b' })
    expect(clearBlock(await screen.findByText('クリア'))).toHaveFocus()
  })

  it('ONCE-1 sessionStorage が使えなくても画面は出る（祝いは毎回判定）', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    stubApi(() => recordReply(CLEARED))
    renderAt({ pathname: `/t/${TRIP_ID}` })
    expect(await screen.findByText('クリア')).toBeInTheDocument()
    expect(await h1()).toBeInTheDocument()
  })

  it('FRESH-1 キャッシュに前の記録があっても、取り直した記録が来るまで「読み込み中」で、来た記録で判定する', async () => {
    // 前の記録（D2 完走）がキャッシュにある。取り直すと D2 は衝突（保存された衝突の run）
    let resolve: (r: Response) => void = () => undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((r) => {
            resolve = r
          }),
      ),
    )
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(['trip-record', TRIP_ID], CLEARED)
    const router = createMemoryRouter([{ path: '/t/:id', element: <RecordPage /> }], {
      initialEntries: [`/t/${TRIP_ID}`],
    })
    renderWithProviders(<RouterProvider router={router} />, { queryClient })
    expect(screen.getByRole('status')).toHaveTextContent('記録を読み込んでいます')
    expect(document.querySelector('.record-clear')).toBeNull()

    const crashed = personaRecord([run({ day: 1 }), run({ day: 2, outcome: 'collided' })])
    resolve(
      new Response(JSON.stringify(crashed), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    expect(await h1()).toHaveFocus()
    expect(document.querySelector('.record-clear')).toBeNull()
  })

  it('CLEAR-6 record.css: 動きを減らす設定では紙吹雪を出さず、円・チェック・文字の動きを止める', () => {
    const reduced = cssBlock(recordCss, '@media (prefers-reduced-motion: reduce)')
    expect(cssBlock(reduced, '.record-clear__confetti')).toContain('display: none')
    for (const part of ['disc', 'ring', 'check', 'title', 'lead']) {
      expect(reduced).toContain(`.record-clear__${part}`)
    }
    expect(reduced).toContain('animation: none')
    // ふだんの形が描き終わった形（動きが止まっても円とチェックが見える）
    expect(cssBlock(recordCss, '.record-clear__ring')).toContain('stroke-dashoffset: 0')
    expect(cssBlock(recordCss, '.record-clear__check')).toContain('stroke-dashoffset: 0')
    // 祝いの色は spruce・alert-safe だけ（alert-danger・clay を使わない）
    const clearCss = recordCss.slice(recordCss.indexOf('.record-clear {'))
    expect(clearCss).not.toMatch(/alert-danger|--clay/)
  })

  it('CLEAR-7 祝いの文言は 4 言語の表にあり、差し込み {n} がそろう', () => {
    for (const lang of ['ja', 'en', 'zh', 'ko'] as const) {
      expect(RECORD_CLEAR_TEXT.clear[lang].trim()).not.toBe('')
      expect(RECORD_CLEAR_TEXT.clearLead[lang]).toContain('{n}')
    }
  })
})

/** CSS の文字列から `head { … }` の中身を取り出す（入れ子の {} を数える） */
function cssBlock(css: string, head: string): string {
  const start = css.indexOf(`${head} {`)
  if (start < 0) return ''
  let depth = 0
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    if (css[i] === '}') depth -= 1
    if (depth === 0) return css.slice(start, i + 1)
  }
  return ''
}
