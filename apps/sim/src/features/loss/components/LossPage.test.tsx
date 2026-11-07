import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatBudget, placeById, STATS } from '@antler/trip'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { stubCountUpEnv } from '@/test/count-up'
import { renderWithProviders } from '@/test/render'
import { TRIP_ID, tripDayBody } from '@/test/trip-day'
import baseline from '../data/loss-baseline.json'
import type { ResolvedCollision } from '../types'
import { lossHref } from '../utils/collision-url'
import { LOSS_TEXT } from '../text'
import { LossPage } from './LossPage'

// vitest は CSS を空にして読む（?raw でも）ので、ファイルを直に読む
const lossCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'loss.css'), 'utf8')

// A-6 の画面（docs/specs/loss/functional.md AC-2・UC-1b・UC-2c・UC-2d・UC-4a・UC-5d・UC-5e・UC-7b、resilience.md の端末の行）。
// api は fetch のスタブ。ペルソナの旅（5 日・4 人・楽しみ 2 件）の D2 の移動（鶴居 → 知床）で、タンチョウのあとに衝突。

// しおりを読む前の文言はブラウザの言語で出す（i18n R5）。既定は日本語のブラウザ（jsdom の既定は en-US）
beforeEach(() => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ja-JP'])
})

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

const collision: ResolvedCollision & { simMs: number } = {
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
    // TEXT-2 リプレイは見送り（result-screens R6）。文言は実際にすること（その日の最初から走り直す）
    expect(screen.getByRole('link', { name: 'この日を最初から走り直す' })).toHaveAttribute(
      'href',
      `/drive?trip=${TRIP_ID}&day=2&alert=off&replay=${String(collision.simMs - 3000)}`,
    )
    expect(screen.getByRole('link', { name: '別の旅をつくる' })).toHaveAttribute('href', '/plan')
    // A-7 の旅の記録へ（record）
    expect(screen.getByRole('link', { name: 'この旅の記録を見る' })).toHaveAttribute(
      'href',
      `/t/${TRIP_ID}`,
    )
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
    expect(screen.getByRole('link', { name: 'この日を最初から走り直す' })).not.toHaveAttribute(
      'href',
      expect.stringContaining('alert=off') as unknown as string,
    )
  })

  it('UC-4h（drive-crash-spot）: spot があれば鹿の発見を 1 行出し、喪失文の api には送らない。無ければ行が無い', async () => {
    const calls = stubApi(() => okDay())
    renderLoss(lossHref({ ...collision, spotting: { appeared: 4, found: 2, early: 1 } }))
    await heading()
    expect(screen.getByTestId('loss-spotting')).toHaveTextContent(
      '自分で見つけた鹿 2 / 4 頭（60 m より前で 1 頭）',
    )
    await waitFor(() => expect(calls.losses).toHaveLength(1))
    expect(calls.losses[0]?.body).not.toHaveProperty('spotting')
  })

  it('UC-4h（drive-crash-spot）: spot の無い URL は鹿の発見の行を出さない', async () => {
    stubApi(() => okDay())
    renderLoss(lossHref(collision))
    await heading()
    expect(screen.queryByTestId('loss-spotting')).toBeNull()
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

describe('LOSS-1: しおりを読む前・失敗はブラウザの言語（i18n R5）', () => {
  it('LOSS-1: zh-TW のブラウザで読み込み中は zh、lang は zh-Hant', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['zh-TW'])
    stubApi(() => 'hang')
    renderLoss(lossHref(collision))
    expect(await screen.findByRole('status')).toHaveTextContent('正在載入行程表')
    expect(document.querySelector('main')).toHaveAttribute('lang', 'zh-Hant')
  })

  describe('落ちて積み重なる（docs/specs/result-screens/functional.md R2）', () => {
    const dropOrder = (el: Element) =>
      Number((el as HTMLElement).style.getPropertyValue('--loss-drop-i'))

    it('DROP-2 カード（文の欄・4 指標・導線・しおり・統計）が DOM の順に 0 から抜けなく増える番号を持ち、見出しは持たない', async () => {
      stubApi(() => okDay())
      renderLoss(lossHref(collision))
      const h1 = await heading()
      const drops = [...document.querySelectorAll('.loss-drop')]
      // 決まった番号を書かない（他のセッションが行を足しても通る）。DOM の順に 0, 1, 2 …
      expect(drops.map(dropOrder)).toEqual(drops.map((_, i) => i))
      expect(drops.length).toBeGreaterThanOrEqual(8)
      // 何が落ちるか（文の欄 → 4 指標 → 導線 → しおり → 統計の順）
      const kinds = drops.map((el) =>
        el.classList.contains('loss-story')
          ? 'story'
          : el.classList.contains('loss-tile')
            ? 'tile'
            : el.classList.contains('loss-actions')
              ? 'actions'
              : el.classList.contains('loss-card')
                ? 'card'
                : el.classList.contains('loss-stats')
                  ? 'stats'
                  : 'other',
      )
      expect(kinds.filter((k) => k !== 'other')).toEqual([
        'story',
        'tile',
        'tile',
        'tile',
        'tile',
        'actions',
        'card',
        'stats',
      ])
      // 傾きは 1° 以内、しおりのカードは −1.5°
      const card = screen.getByRole('region', { name: '旅のしおり' })
      expect(card.style.getPropertyValue('--loss-tilt')).toBe('-1.5deg')
      // 見出しは落ちない。遷移のフォーカスを受ける
      expect(h1.closest('.loss-drop')).toBeNull()
      expect(h1).toHaveFocus()
    })

    it('DROP-4 読み込み中・読めない画面には loss-drop が無い', async () => {
      stubApi(() => 'hang')
      renderLoss(lossHref(collision))
      await screen.findByRole('status')
      expect(document.querySelector('.loss-drop')).toBeNull()

      stubApi(() => okDay())
      renderLoss('/loss/x?day=abc')
      await screen.findByRole('heading', { level: 1, name: '衝突の情報が読めません。' })
      expect(document.querySelector('.loss-drop')).toBeNull()
    })

    it('DROP-3・DROP-5 loss.css: 動きを減らす設定は不透明度だけ、フォーカスが入ったら動きを止める', () => {
      const css = lossCss
      const reduced = cssBlock(css, '@media (prefers-reduced-motion: reduce)')
      expect(reduced).toContain('animation-name: loss-fade')
      expect(reduced).not.toMatch(/translate|scale/)
      expect(cssBlock(css, '@keyframes loss-fade')).not.toContain('transform')
      // フォーカスが入ったら止まった形で見せる。animation は外さない（外すと抜けたときに落ち直す）
      const focused = cssBlock(css, '.loss-drop:focus-within')
      expect(focused).toContain('opacity: 1 !important')
      expect(focused).toContain('transform: rotate(var(--loss-tilt, 0deg)) !important')
      expect(focused).not.toContain('animation')
      // 喪失の画面の動きに alert-danger を使わない（✕ の行だけ）
      expect(cssBlock(css, '@keyframes loss-drop')).not.toContain('alert-danger')
    })
  })

  it('TEXT-2 副の導線の文言は 4 言語とも「この日を最初から走り直す」で、「3 秒前」を言わない（result-screens R6）', () => {
    expect(LOSS_TEXT.replay).toEqual({
      ja: 'この日を最初から走り直す',
      en: 'Restart this day from the beginning',
      zh: '從頭重跑這一天',
      ko: '이 날을 처음부터 다시 달리기',
    })
    const all = Object.values(LOSS_TEXT).flatMap((entry) => Object.values(entry))
    expect(all.filter((s) => /3 秒前|3 seconds|前 3 秒|3초 전/.test(s))).toEqual([])
  })

  it('LINK-1 「この旅の記録を見る」は衝突のあとの合図（location state）を付けて /t/:id へ移る（result-screens R4）', async () => {
    const user = userEvent.setup()
    stubApi(() => okDay())
    const router = createMemoryRouter(
      [
        { path: '/loss/:id', element: <LossPage /> },
        { path: '/t/:id', element: <p>record</p> },
      ],
      { initialEntries: [lossHref(collision)] },
    )
    renderWithProviders(<RouterProvider router={router} />)
    await heading()
    await user.click(screen.getByRole('link', { name: 'この旅の記録を見る' }))
    expect(router.state.location.pathname).toBe(`/t/${TRIP_ID}`)
    expect(router.state.location.state).toEqual({ arrival: 'after-collision' })
  })

  it('result-countup LOSS-1: 4 指標の値と統計カードの件数・金額が数え上がり、年・期間・補足・導入・しおりは動かない。分母は動かない', async () => {
    const env = stubCountUpEnv()
    stubApi(() => okDay())
    renderLoss(lossHref(collision))
    await heading()
    const metrics = tiles() as HTMLElement
    const values = [...metrics.querySelectorAll('.loss-tile__value')]
    const frameIn = (el: Element) => el.querySelector('.count-up__frame')?.textContent ?? null
    // 始まりのコマ（円とドルの両方が 0、分母は 2 のまま）
    expect(values.map(frameIn)).toEqual(['¥0（約 $0）', '¥0（約 $0）', '0', '0 / 2'])
    // 補足・導入・しおりのカードには数え上げが無い
    expect(metrics.querySelector('.loss-tile__note .count-up')).toBeNull()
    expect(document.querySelector('.loss-intro .count-up')).toBeNull()
    expect(document.querySelector('.loss-card .count-up')).toBeNull()

    // 統計カード: 件数・金額の 6 つだけ。年と期間は最初から最後の値
    const stats = screen.getByRole('region', { name: /これは、北海道で/ })
    const d = STATS.deerAccidents
    const ins = STATS.vehicleInsurance
    const n = (v: number) => v.toLocaleString('en-US')
    expect([...stats.querySelectorAll('.count-up__final')].map((e) => e.textContent)).toEqual([
      n(d.total),
      n(d.previousYearTotal),
      n(d.kushiroArea),
      n(ins.claims),
      formatBudget(ins.paidJPY, 'ja'),
      formatBudget(ins.averageJPY, 'ja'),
    ])
    // 見出しの名前（読み上げ）は最後の値
    expect(
      screen.getByRole('region', {
        name: `これは、北海道で ${String(d.year)} 年に ${n(d.total)} 件起きたこと`,
      }),
    ).toBeInTheDocument()

    // 見えて、全部のカードが着地して数え終わると、今の表示と同じ（既存の AC-2 と同じ文字列）
    env.intersect()
    env.advance(4000)
    expect(document.querySelector('.count-up--running')).toBeNull()
    const m = within(metrics)
    expect(m.getByText(formatBudget(STATS.vehicleInsurance.averageJPY, 'ja'))).toBeInTheDocument()
    expect(m.getByText('1 / 2')).toBeInTheDocument()
    expect(stats).toHaveTextContent(`${String(d.year)} 年に ${n(d.total)} 件`)
    expect(stats).toHaveTextContent(`前年 ${n(d.previousYearTotal)} 件`)
    expect(stats).toHaveTextContent(formatBudget(ins.averageJPY, 'ja'))
  })

  it('result-countup LOSS-2: 数え上げはそのカードの着地（番号 × 150 ms ＋ 820 ms）から始まる', async () => {
    const env = stubCountUpEnv()
    stubApi(() => okDay())
    renderLoss(lossHref(collision))
    await heading()
    const values = [...(tiles() as HTMLElement).querySelectorAll('.loss-tile__value')]
    const frameIn = (el: Element | undefined) =>
      el?.querySelector('.count-up__frame')?.textContent ?? null
    env.intersect()
    // 車の修理は 2 番目（番号 1）: 970 ms で着地。950 ms ではまだ 0
    env.advance(950)
    expect(frameIn(values[0])).toBe('¥0（約 $0）')
    env.advance(200)
    expect(frameIn(values[0])).not.toBe('¥0（約 $0）')
    // 失った日数は番号 3: 1270 ms で着地。1150 ms ではまだ 0
    expect(frameIn(values[2])).toBe('0')
  })

  it('result-countup S-1: 動きを減らす設定では最初から最後の値（分けた形が無い）', async () => {
    stubCountUpEnv({ reducedMotion: true })
    stubApi(() => okDay())
    renderLoss(lossHref(collision))
    await heading()
    expect(document.querySelector('.count-up--running')).toBeNull()
    expect(within(tiles() as HTMLElement).getByText('1 / 2')).toBeInTheDocument()
  })

  it('LOSS-1: en のブラウザで読めない URL は en', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US'])
    stubApi(() => okDay())
    const href = lossHref({ ...collision, speedKmh: 54 }).replace('speed=54', 'speed=250')
    renderLoss(href)
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'The collision details could not be read.',
      }),
    ).toBeInTheDocument()
  })
})
