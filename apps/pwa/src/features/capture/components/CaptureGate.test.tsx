import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderWithProviders as render } from '@/test/render'
import {
  API_BASE,
  captureId,
  jsonResponse,
  makeCapture,
  type ApiBehavior,
} from '../__tests__/fake-edge'
import { rig } from '../__tests__/rig'
import { CAPTURE_TEXT } from '../i18n'
import type { FetchLike } from '../lib/upload'
import { CaptureGate } from './CaptureGate'

const created: ApiBehavior = (call) =>
  jsonResponse(201, { id: call.capture.id, image: call.capture.image })
const items = (n: number) => Array.from({ length: n }, (_, i) => makeCapture(i + 1))
const sleepMs = (ms: number) =>
  new Promise<void>((resolveSleep) => {
    setTimeout(resolveSleep, ms)
  })

/** 通信が一巡したあとも、何も重ならないこと */
async function expectNoDialog(listCalls: () => number) {
  await waitFor(() => {
    expect(listCalls()).toBeGreaterThanOrEqual(1)
  })
  await sleepMs(60)
  expect(screen.queryByRole('dialog')).toBeNull()
}

describe('CaptureGate: 入口（P1）', () => {
  it('GATE-1a: 3 秒以内に未送信が 1 件以上取れ、idleSeconds が null のとき画面が重なる', async () => {
    const { services } = rig({ items: items(1), idleSeconds: null })
    render(<CaptureGate services={services} />)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('GATE-1a: idleSeconds が 60 秒ちょうどなら重なる（61 秒でも）', async () => {
    const { services } = rig({ items: items(1), idleSeconds: 60 })
    render(<CaptureGate services={services} />)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('GATE-1a: idleSeconds が 60 秒未満（走行中の再読み込み）では重ならない', async () => {
    const { services, backend } = rig({ items: items(2), idleSeconds: 59.9 })
    render(<CaptureGate services={services} />)
    await expectNoDialog(() => backend.edgeCalls.length)
  })

  it('GATE-1a: 0 件では重ならない', async () => {
    const { services, backend } = rig({ items: [] })
    render(<CaptureGate services={services} />)
    await expectNoDialog(() => backend.edgeCalls.length)
  })

  it('GATE-1a: 取得に失敗したら重ならない（リトライもしない）', async () => {
    const { services, backend } = rig({ items: items(1), edgeFault: () => 'network' })
    render(<CaptureGate services={services} />)
    await expectNoDialog(() => backend.edgeCalls.length)
    await sleepMs(30)
    expect(backend.edgeCalls).toHaveLength(1)
  })

  it('GATE-1a: 3 秒（ここでは 20ms）を超えたら重ならない。遅れて届いても出さない', async () => {
    const { services, backend } = rig(
      { items: items(2) },
      { timeouts: { listMs: 20, edgeMs: 1000, apiMs: 1000 } },
    )
    let calls = 0
    const slow: FetchLike = async (url, init) => {
      calls += 1
      await sleepMs(80)
      return backend.fetch(url, init)
    }
    render(<CaptureGate services={{ ...services, fetch: slow }} />)
    await expectNoDialog(() => calls)
    await sleepMs(150)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('GATE-1a: edge につながらなければ何も出ない（B-0 は今までどおり）', async () => {
    const calls: string[] = []
    const down: FetchLike = (url) => {
      calls.push(url)
      return Promise.reject(new TypeError('Failed to fetch'))
    }
    const { services } = rig({ items: items(1) }, { fetch: down })
    const { container } = render(<CaptureGate services={services} />)
    await expectNoDialog(() => calls.length)
    expect(container).toBeEmptyDOMElement()
  })

  it('GATE-1f: VITE_API_BASE_URL が無ければ（送り先が無いので）何も描かず、通信もしない', async () => {
    const { services, backend } = rig({ items: items(2) }, { apiBaseUrl: undefined })
    const { container } = render(<CaptureGate services={services} />)
    await sleepMs(60)
    expect(container).toBeEmptyDOMElement()
    expect(backend.edgeCalls).toHaveLength(0)
  })
})

describe('CaptureGate: 画面（P2）', () => {
  it('GATE-1b: 件数・サムネイル（最大 6 枚）・チェック（初期 ON）・主ボタン「送る」・「あとで」が出る', async () => {
    const { services } = rig({ items: items(8) })
    render(<CaptureGate services={services} />)
    const dialog = await screen.findByRole('dialog')

    expect(dialog).toHaveAccessibleName('未送信の検知フレーム 8 件')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const images = within(dialog).getAllByRole('img')
    expect(images).toHaveLength(6)
    expect(images[0]).toHaveAttribute(
      'src',
      `http://ezoroad.local:8767/captures/${captureId(1)}/image`,
    )
    expect(images[0]).toHaveAttribute('alt', '検知フレーム 1')
    expect(within(dialog).getByRole('checkbox', { name: '提供する（匿名）' })).toBeChecked()
    expect(within(dialog).getByRole('button', { name: /送る/ })).toHaveTextContent('送る')
    expect(within(dialog).getByRole('button', { name: /あとで/ })).toBeInTheDocument()
    expect(dialog.parentElement).toHaveAttribute('data-theme', 'night')
    // 説明: 匿名・車内は写さない・区間に丸める・通知は変わらない・提供しないとこの機器からも消える
    expect(within(dialog).getByText(/匿名で提供します/)).toBeInTheDocument()
    expect(within(dialog).getByText(/車内は写しません/)).toBeInTheDocument()
    expect(within(dialog).getByText(/区間/)).toBeInTheDocument()
    expect(within(dialog).getByText(/通知はこれまでと変わりません/)).toBeInTheDocument()
    expect(within(dialog).getByText(/この機器からも消えます/)).toBeInTheDocument()
  })

  it('GATE-1b: チェックを外すと主ボタンが「提供しない」になる（戻すと「送る」）', async () => {
    const user = userEvent.setup()
    const { services } = rig({ items: items(1) })
    render(<CaptureGate services={services} />)
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('checkbox'))
    expect(within(dialog).getByRole('checkbox')).not.toBeChecked()
    expect(within(dialog).getByRole('button', { name: /提供しない/ })).toHaveTextContent(
      '提供しない',
    )
    await user.click(within(dialog).getByRole('checkbox'))
    expect(within(dialog).getByRole('button', { name: /送る/ })).toHaveTextContent('送る')
  })

  it('GATE-1c: 「あとで」で閉じると B-0 が見える。何も送らない・edge の状態を変えない', async () => {
    const user = userEvent.setup()
    const { services, backend } = rig({ items: items(2) })
    render(<CaptureGate services={services} />)
    await user.click(await screen.findByRole('button', { name: /あとで/ }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await sleepMs(30)
    expect(backend.edgeCalls.map((c) => c.route)).toEqual(['list'])
    expect(backend.apiCalls).toHaveLength(0)
    expect(backend.state.items.every((i) => !i.uploaded && !i.capture.consent)).toBe(true)
  })

  it('GATE-1d: 主文は端末の言語（en-US は en）', async () => {
    const { services } = rig({ items: items(3) }, { languages: ['en-US'] })
    render(<CaptureGate services={services} />)
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAccessibleName('Unsent detection frames: 3')
    expect(dialog).toHaveAttribute('lang', 'en')
    expect(within(dialog).getByRole('button', { name: /send/i })).toHaveTextContent(
      CAPTURE_TEXT.en.send,
    )
  })

  it('GATE-1d: zh-TW の端末は zh（繁体字）で出る', async () => {
    const { services } = rig({ items: items(3) }, { languages: ['zh-TW'] })
    render(<CaptureGate services={services} />)
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAttribute('lang', 'zh')
    expect(dialog).toHaveAccessibleName('尚未傳送的偵測影格 3 張')
    expect(within(dialog).getByRole('button', { name: /傳送/ })).toHaveTextContent(
      CAPTURE_TEXT.zh.send,
    )
  })

  it('GATE-1e: ボタン・チェックに名前があり、アイコン（SVG）は読み上げず、絵文字がない', async () => {
    const { services } = rig({ items: items(2) })
    render(<CaptureGate services={services} />)
    const dialog = await screen.findByRole('dialog')
    for (const button of within(dialog).getAllByRole('button')) {
      expect(button).toHaveAccessibleName()
      expect(button.getAttribute('aria-label')).toBeTruthy()
    }
    for (const svg of dialog.querySelectorAll('svg')) {
      expect(svg).toHaveAttribute('aria-hidden', 'true')
    }
    expect(dialog.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
    expect(within(dialog).getByRole('checkbox')).toHaveAccessibleName()
  })

  it('GATE-1e: CSS はボタンとチェックの行が 44px 以上、色はトークンの変数だけ（直書きなし）', () => {
    const css = readFileSync(resolve(__dirname, 'capture.css'), 'utf8')
    const minHeight = (selector: string) => {
      const block =
        new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''
      return Number(/min-height:\s*(\d+)px/.exec(block)?.[1] ?? 0)
    }
    expect(minHeight('.capture__button')).toBeGreaterThanOrEqual(44)
    expect(minHeight('.capture__button--primary')).toBeGreaterThanOrEqual(44)
    expect(minHeight('.capture__consent')).toBeGreaterThanOrEqual(44)
    expect(/\.capture__check\s*\{[^}]*width:\s*(\d+)px/.exec(css)?.[1]).toBeDefined()
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(css).not.toMatch(/\b(?:rgba?|hsla?)\(/)

    const sources = ['CaptureDialog.tsx', 'CaptureIcon.tsx', 'CaptureOffer.tsx', 'CaptureGate.tsx']
    for (const file of sources) {
      const source = readFileSync(resolve(__dirname, file), 'utf8')
      expect(source, file).not.toMatch(/#[0-9a-fA-F]{6}\b|\brgba?\(/)
      expect(source, file).not.toMatch(/\p{Extended_Pictographic}/u)
    }
  })
})

describe('CaptureGate: 送る（P3）', () => {
  it('UP-1a: OFF で「提供しない」→ edge に consent:false を送り、api には何も送らない。完了の文言と閉じる', async () => {
    const user = userEvent.setup()
    const { services, backend } = rig({ items: items(2), api: created })
    render(<CaptureGate services={services} />)
    await user.click(await screen.findByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /提供しない/ }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('2 件をこの機器から消しました')
    })
    expect(backend.apiCalls).toHaveLength(0)
    expect(backend.edgeCalls.filter((c) => c.route === 'consent').map((c) => c.body)).toEqual([
      { consent: false, ids: [captureId(1), captureId(2)] },
    ])
    await user.click(screen.getByRole('button', { name: '閉じる' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('UP-1h: 進み具合「n / N」と完了の文言が出る', async () => {
    const user = userEvent.setup()
    const { services, backend } = rig({ items: items(2), api: created })
    let release: () => void = () => undefined
    const hold = new Promise<void>((resolveHold) => {
      release = resolveHold
    })
    const held: FetchLike = async (url, init) => {
      if (url.startsWith(API_BASE)) await hold
      return backend.fetch(url, init)
    }
    render(<CaptureGate services={{ ...services, fetch: held }} />)
    await user.click(await screen.findByRole('button', { name: /送る/ }))

    expect(await screen.findByText('0 / 2')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('送っています')
    release()
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('2 件を提供しました（失敗 0 件）')
    })
    expect(screen.getByRole('button', { name: '閉じる' })).toBeInTheDocument()
  })

  it('UP-1i: 429 の待ちの間は「混み合っているため、少し待っています」を出す', async () => {
    const user = userEvent.setup()
    let release: () => void = () => undefined
    const hold = new Promise<void>((resolveHold) => {
      release = resolveHold
    })
    const { services } = rig(
      {
        items: items(1),
        api: (call, n) =>
          n === 1 ? jsonResponse(429, {}, { 'Retry-After': '20' }) : created(call, n),
      },
      { sleep: () => hold },
    )
    render(<CaptureGate services={services} />)
    await user.click(await screen.findByRole('button', { name: /送る/ }))
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('混み合っているため、少し待っています')
    })
    release()
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('1 件を提供しました')
    })
  })

  it.each([
    [
      '429 のまま',
      jsonResponse(429, {}, { 'Retry-After': '1' }),
      '混み合っています。しばらくしてからもう一度',
    ],
    ['404', jsonResponse(404, {}), '送り先に届きませんでした'],
    ['503', jsonResponse(503, {}), '回線がつながったら、もう一度送ってください'],
  ])(
    'UP-1i/UP-1d: %s で止まったら文言と「もう一度」が出る（回線の文言は回線のときだけ）',
    async (_name, response, message) => {
      const user = userEvent.setup()
      const { services, backend } = rig({ items: items(1), api: () => response })
      render(<CaptureGate services={services} />)
      await user.click(await screen.findByRole('button', { name: /送る/ }))
      await waitFor(() => {
        expect(screen.getByRole('status')).toHaveTextContent(message)
      })
      expect(screen.getByRole('button', { name: 'もう一度' })).toBeInTheDocument()
      expect(backend.state.items[0]?.uploaded).toBe(false)
      // 閉じても何も変わらない（「あとで」）
      await user.click(screen.getByRole('button', { name: 'あとで' }))
      expect(screen.queryByRole('dialog')).toBeNull()
    },
  )

  it('UP-1j: 車載につながらなくなったら「車載とつながりません」と「もう一度」', async () => {
    const user = userEvent.setup()
    const { services } = rig({
      items: items(1),
      api: created,
      edgeFault: (route) => (route === 'consent' ? 'network' : undefined),
    })
    render(<CaptureGate services={services} />)
    await user.click(await screen.findByRole('button', { name: /送る/ }))
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('車載とつながりません')
    })
  })

  it('UP-1e: 失敗が混じった完了は「失敗 M 件」を出す', async () => {
    const user = userEvent.setup()
    const { services } = rig({
      items: items(2),
      api: (call, n) => (n === 1 ? jsonResponse(422, {}) : created(call, n)),
    })
    render(<CaptureGate services={services} />)
    await user.click(await screen.findByRole('button', { name: /送る/ }))
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('1 件を提供しました（失敗 1 件）')
    })
  })

  it('UP-1d: 送っている最中にもう一度押しても二重に始まらない', async () => {
    const user = userEvent.setup()
    const { services, backend } = rig({ items: items(1), api: created })
    render(<CaptureGate services={services} />)
    const button = await screen.findByRole('button', { name: /送る/ })
    await user.dblClick(button)
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('1 件を提供しました')
    })
    expect(backend.apiCalls).toHaveLength(1)
  })
})
