import { formatBudget, placeById, STATS } from '@antler/trip'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { renderWithProviders } from '@/test/render'
import { TRIP_ID, tripDayBody } from '@/test/trip-day'
import baseline from '../data/loss-baseline.json'
import type { CollisionReport } from '../types'
import { lossHref } from '../utils/collision-url'
import { LossPage } from './LossPage'

// A-6 の画面（docs/specs/loss/functional.md AC-2・UC-1b・UC-2c・UC-2d・UC-4a・UC-5d・UC-5e・UC-7b、resilience.md の端末の行）。
// api は fetch のスタブ。ペルソナの旅（5 日・4 人・楽しみ 2 件）の D2 の移動（鶴居 → 知床）で、タンチョウのあとに衝突。

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

type Reply = { status: number; body: unknown } | 'hang'
type Calls = { days: string[]; losses: { url: string; body: unknown }[] }

const STORY = {
  ja: 'タンチョウの舞いは見られました。けれど知床の流氷ウォークは、次の旅に持ち越しです。',
  en: 'You saw the cranes dance. The drift-ice walk in Shiretoko waits for the next trip.',
  zh: '看到了丹頂鶴的舞姿。但知床的流冰漫步，只能留到下一趟旅程。',
  ko: '두루미의 춤은 볼 수 있었습니다. 하지만 시레토코의 유빙 워크는 다음 여행으로 미뤄졌습니다.',
}

// その日の行程の組み立ては重い（ルートとゾーンの計算）ので、言語ごとに 1 回だけ作る
const DAY_BODY = { ja: tripDayBody(2, 'ja'), en: tripDayBody(2, 'en') }
const okDay = (lang: 'ja' | 'en' = 'ja'): Reply => ({ status: 200, body: DAY_BODY[lang] })
const okStory = (status = 201): Reply => ({
  status,
  body: { loss: { tripId: TRIP_ID, story: STORY, createdAt: '2026-11-04T10:00:00+09:00' } },
})
const fail = (status: number, code: string): Reply => ({
  status,
  body: { error: { code, message: 'x' } },
})

function stubApi(day: () => Reply, loss: () => Reply = () => okStory()): Calls {
  const calls: Calls = { days: [], losses: [] }
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      let r: Reply
      if (url.includes('/losses')) {
        calls.losses.push({ url, body: JSON.parse(String(init?.body)) as unknown })
        r = loss()
      } else {
        calls.days.push(url)
        r = day()
      }
      if (r === 'hang') return new Promise<Response>(() => undefined)
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

const collision: CollisionReport = {
  tripId: TRIP_ID,
  day: 2,
  leg: 0,
  at: '2027-02-15T16:31:00+09:00',
  speedKmh: 54,
  light: 'dusk',
  side: 'L',
  alertEnabled: false,
  achievedStops: ['red-crowned-crane'],
  simMs: 812345,
}

function renderLoss(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/loss/:id', element: <LossPage /> },
      { path: '/plan', element: <p>plan</p> },
    ],
    { initialEntries: [path] },
  )
  renderWithProviders(<RouterProvider router={router} />)
  return router
}

const place = (id: string) => placeById(id)?.name.ja ?? id
const TSURUI = place('tsurui')
const SHIRETOKO = place('shiretoko')

const heading = () => screen.findByRole('heading', { level: 1, name: '旅は、ここで終わりました。' })
const tiles = () => screen.queryByRole('region', { name: '失ったもの' })

describe('LossPage（A-6）', () => {
  it('AC-2: しおりに ✕ と取り消し線、4 指標、統計カードの出典、Claude の文が出て、主ボタンが /trip/:id/brief?day=n を指す', async () => {
    const calls = stubApi(() => okDay())
    renderLoss(lossHref(collision))
    await heading()

    // 衝突の事実（端末の定型文）と eyebrow
    expect(screen.getByText(`DAY 2 ・ 16:31 ・ ${TSURUI} → ${SHIRETOKO}`)).toBeInTheDocument()
    expect(
      screen.getByText(
        '薄暮、左から出てきた鹿と、時速 54 km で衝突しました。鹿アラートは OFF でした。車はもう走れません。',
      ),
    ).toBeInTheDocument()

    // しおり
    const card = screen.getByRole('region', { name: '旅のしおり' })
    const rows = within(card).getAllByRole('listitem')
    const collisionRow = rows.find((r) => r.className.includes('loss-row--collision'))
    expect(collisionRow).toHaveTextContent(`16:31 ${TSURUI} → ${SHIRETOKO} で衝突`)
    expect(within(card).getAllByText('（取り消し）').length).toBeGreaterThan(1)

    // 4 指標
    const metrics = tiles()
    expect(metrics).not.toBeNull()
    const m = within(metrics as HTMLElement)
    expect(m.getByText(formatBudget(STATS.vehicleInsurance.averageJPY, 'ja'))).toBeInTheDocument()
    const cancel = (3 * baseline.lodgingPerPersonNightJPY + 1 * baseline.experiencePerPersonJPY) * 4
    expect(m.getByText(formatBudget(Math.floor(cancel / 1000) * 1000, 'ja'))).toBeInTheDocument()
    expect(m.getByText('宿 3 泊・楽しみ 1 件・4 人分')).toBeInTheDocument()
    expect(m.getByText('概算（単価の出典なし）')).toBeInTheDocument()
    expect(m.getByText('D2〜D5')).toBeInTheDocument()
    expect(m.getByText('1 / 2')).toBeInTheDocument()
    expect(m.getByText('楽しみ 2 つのうち')).toBeInTheDocument()

    // 統計カード
    const stats = screen.getByRole('region', { name: /これは、北海道で/ })
    expect(stats).toHaveTextContent(STATS.deerAccidents.source.name)
    expect(stats).toHaveTextContent(STATS.vehicleInsurance.source.name)

    // Claude の文（POST の body は day / leg / at / alertEnabled / achievedStops だけ）
    expect(await screen.findByText(STORY.ja)).toBeInTheDocument()
    expect(calls.losses).toHaveLength(1)
    expect(calls.losses[0]?.url).toMatch(new RegExp(`/api/trips/${TRIP_ID}/losses$`))
    expect(calls.losses[0]?.body).toEqual({
      day: 2,
      leg: 0,
      at: collision.at,
      alertEnabled: false,
      achievedStops: ['red-crowned-crane'],
    })

    // 導線
    expect(
      screen.getByRole('link', { name: '鹿アラートを ON にして、同じ道をやり直す' }),
    ).toHaveAttribute('href', `/trip/${TRIP_ID}/brief?day=2`)
  })

  it('UC-7b: 副の導線は /drive?…&alert=off&replay=simMs−3000 と /plan', async () => {
    stubApi(() => okDay())
    renderLoss(lossHref(collision))
    await heading()
    expect(screen.getByRole('link', { name: '衝突の 3 秒前を見る' })).toHaveAttribute(
      'href',
      `/drive?trip=${TRIP_ID}&day=2&alert=off&replay=${String(collision.simMs - 3000)}`,
    )
    expect(screen.getByRole('link', { name: '別の旅をつくる' })).toHaveAttribute('href', '/plan')
  })

  it('UC-2c: LossCard はタイトルに <s>、✕ の行に「衝突」の文と時刻、lost の行に読み上げ用の「取り消し」', async () => {
    stubApi(() => okDay())
    renderLoss(lossHref(collision))
    await heading()
    const card = screen.getByRole('region', { name: '旅のしおり' })
    const title = card.querySelector('.loss-card__title s')
    expect(title).toHaveTextContent(DAY_BODY.ja.details.titles.ja)
    const lost = card.querySelectorAll('.loss-row--lost')
    // D2 の宿・D3 の流氷と宿・D4 の宿・D5 の行程
    expect(lost).toHaveLength(5)
    for (const li of lost) {
      expect(li.querySelector('s')).not.toBeNull()
      expect(li).toHaveTextContent('（取り消し）')
    }
    const achieved = card.querySelectorAll('.loss-row--achieved')
    expect([...achieved].map((li) => li.textContent)).toEqual([
      `D1 ${place('cts')} → ${TSURUI}（済み）`,
      `D1 ${TSURUI}泊（済み）`,
      expect.stringContaining('D2 ') as unknown as string,
    ])
    // ✓ / ✕ は SVG（文字の記号を使わない）
    expect(card.querySelectorAll('.loss-row__mark svg')).toHaveLength(achieved.length + 1)
  })

  it('UC-4a: 統計カードは STATS の件数と保険の平均を出し、出典名をすべて書く。verified:false には再照合中', async () => {
    stubApi(() => okDay())
    renderLoss(lossHref(collision))
    await heading()
    const stats = screen.getByRole('region', { name: /これは、北海道で/ })
    const n = (v: number) => v.toLocaleString('en-US')
    const d = STATS.deerAccidents
    const ins = STATS.vehicleInsurance
    expect(stats).toHaveTextContent(`${String(d.year)} 年に ${n(d.total)} 件`)
    expect(stats).toHaveTextContent(`前年 ${n(d.previousYearTotal)} 件`)
    expect(stats).toHaveTextContent(`釧路方面 ${n(d.kushiroArea)} 件`)
    expect(stats).toHaveTextContent(`${n(ins.claims)} 件`)
    expect(stats).toHaveTextContent(formatBudget(ins.averageJPY, 'ja'))
    const sources = within(stats).getAllByRole('listitem')
    for (const s of [d.source, ins.source]) {
      const item = sources.find((li) => li.textContent?.includes(s.name))
      expect(item).toBeDefined()
      if (s.verified) expect(item).not.toHaveTextContent('再照合中')
      else expect(item).toHaveTextContent('出典の再照合中')
    }
  })

  it('UC-1b: 読めない URL は「読めません」と /plan への導線だけで、fetch しない', async () => {
    const calls = stubApi(() => okDay())
    const href = lossHref({ ...collision, speedKmh: 54 }).replace('speed=54', 'speed=250')
    renderLoss(href)
    expect(
      await screen.findByRole('heading', { level: 1, name: '衝突の情報が読めません。' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '旅をつくる画面へ' })).toHaveAttribute('href', '/plan')
    expect(screen.queryByRole('button')).toBeNull()
    expect(calls.days).toHaveLength(0)
    expect(calls.losses).toHaveLength(0)
  })

  it('UC-1b: しおりの規則に外れる（その日に無い楽しみ）→「読めません」、喪失文の api は呼ばない', async () => {
    const calls = stubApi(() => okDay())
    renderLoss(lossHref({ ...collision, achievedStops: ['drift-ice-walk'] }))
    expect(
      await screen.findByRole('heading', { level: 1, name: '衝突の情報が読めません。' }),
    ).toBeInTheDocument()
    expect(calls.days).toHaveLength(1)
    expect(calls.losses).toHaveLength(0)
  })

  it('UC-1b: 日が旅に無い（DAY_NOT_FOUND）→「読めません」', async () => {
    const calls = stubApi(() => fail(404, 'DAY_NOT_FOUND'))
    renderLoss(lossHref({ ...collision, day: 9 }))
    expect(
      await screen.findByRole('heading', { level: 1, name: '衝突の情報が読めません。' }),
    ).toBeInTheDocument()
    expect(calls.losses).toHaveLength(0)
  })

  it('UC-2d: しおりの読み込み中は 4 指標の枠を出さずに「しおりを読み込んでいます」', async () => {
    stubApi(() => 'hang')
    renderLoss(lossHref(collision))
    expect(await screen.findByRole('status')).toHaveTextContent('しおりを読み込んでいます')
    expect(tiles()).toBeNull()
  })

  it('UC-2d: 404 →「旅が見つかりません」と /plan、409 →「古い形式」と /plan', async () => {
    stubApi(() => fail(404, 'TRIP_NOT_FOUND'))
    renderLoss(lossHref(collision))
    expect(await screen.findByRole('heading', { name: '旅が見つかりません。' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '旅をつくる画面へ' })).toHaveAttribute('href', '/plan')
  })

  it('UC-2d: 409 →「この旅は古い形式です」と /plan', async () => {
    const calls = stubApi(() => fail(409, 'ITINERARY_CHANGED'))
    renderLoss(lossHref(collision))
    expect(
      await screen.findByRole('heading', {
        name: 'この旅は古い形式です。もう一度つくってください。',
      }),
    ).toBeInTheDocument()
    expect(calls.losses).toHaveLength(0)
  })

  it('UC-2d: 5xx → 1 回だけ再試行してから「もう一度」。押して成功すれば画面が出る', async () => {
    let failing = true
    const calls = stubApi(() => (failing ? fail(500, 'INTERNAL_ERROR') : okDay()))
    renderLoss(lossHref(collision))
    expect(
      await screen.findByRole(
        'heading',
        { name: 'しおりを読み込めませんでした。' },
        { timeout: 3000 },
      ),
    ).toBeInTheDocument()
    expect(calls.days).toHaveLength(2)
    failing = false
    await userEvent.click(screen.getByRole('button', { name: 'もう一度' }))
    expect(await heading()).toBeInTheDocument()
  })

  it('UC-5d: 文を待つあいだも 4 指標・しおり・統計カードを出す', async () => {
    stubApi(
      () => okDay(),
      () => 'hang',
    )
    renderLoss(lossHref(collision))
    await heading()
    expect(tiles()).not.toBeNull()
    expect(screen.getByRole('region', { name: '旅のしおり' })).toBeInTheDocument()
    const story = screen.getByRole('region', { name: 'Claude が書いた、失ったもの' })
    expect(within(story).getByText(/文を用意しています/)).toBeInTheDocument()
  })

  it('UC-5d: 文の失敗（502）は文の欄だけ「用意できませんでした」と「もう一度」。自動の再試行なし', async () => {
    let storyReply: Reply = fail(502, 'WRITER_FAILED')
    const calls = stubApi(
      () => okDay(),
      () => storyReply,
    )
    renderLoss(lossHref(collision))
    await heading()
    const story = screen.getByRole('region', { name: 'Claude が書いた、失ったもの' })
    expect(await within(story).findByText('文を用意できませんでした。')).toBeInTheDocument()
    expect(tiles()).not.toBeNull()
    // 少し待っても裏で呼び直さない
    await new Promise((r) => setTimeout(r, 600))
    expect(calls.losses).toHaveLength(1)
    storyReply = okStory(200)
    await userEvent.click(within(story).getByRole('button', { name: 'もう一度' }))
    expect(await within(story).findByText(STORY.ja)).toBeInTheDocument()
    expect(calls.losses).toHaveLength(2)
  })

  it.each(['DAILY_LIMIT', 'LOSS_LIMIT'])(
    'UC-5d: 429（%s）は「本日の上限に達しました」だけでボタンなし',
    async (code) => {
      stubApi(
        () => okDay(),
        () => fail(429, code),
      )
      renderLoss(lossHref(collision))
      await heading()
      const story = screen.getByRole('region', { name: 'Claude が書いた、失ったもの' })
      expect(await within(story).findByText('本日の上限に達しました。')).toBeInTheDocument()
      expect(within(story).queryByRole('button')).toBeNull()
      expect(tiles()).not.toBeNull()
    },
  )

  it('UC-5d: 応答の形が違う → 文の欄の失敗（白い画面にならない）', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    stubApi(
      () => okDay(),
      () => ({ status: 201, body: { loss: { tripId: TRIP_ID, story: { ja: 'x' } } } }),
    )
    renderLoss(lossHref(collision))
    await heading()
    expect(await screen.findByText('文を用意できませんでした。')).toBeInTheDocument()
  })

  it('UC-5e: アラート ON の衝突 → body は alertEnabled:true、主ボタンは「同じ道を、もう一度走る」、「OFF でした」が無い', async () => {
    const calls = stubApi(() => okDay())
    renderLoss(lossHref({ ...collision, alertEnabled: true }))
    await heading()
    await waitFor(() => expect(calls.losses).toHaveLength(1))
    expect(calls.losses[0]?.body).toMatchObject({ alertEnabled: true })
    expect(screen.getByRole('link', { name: '同じ道を、もう一度走る' })).toHaveAttribute(
      'href',
      `/trip/${TRIP_ID}/brief?day=2`,
    )
    expect(screen.queryByText(/OFF でした/)).toBeNull()
    expect(screen.getByRole('link', { name: '衝突の 3 秒前を見る' })).not.toHaveAttribute(
      'href',
      expect.stringContaining('alert=off') as unknown as string,
    )
  })

  it('R10: 画面の文言は plan.lang（en）で、Claude の文も en', async () => {
    stubApi(() => okDay('en'))
    renderLoss(lossHref(collision))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'The trip ended here.' }),
    ).toBeInTheDocument()
    expect(await screen.findByText(STORY.en)).toBeInTheDocument()
    expect(document.querySelector('.loss')).toHaveAttribute('lang', 'en')
  })
})
