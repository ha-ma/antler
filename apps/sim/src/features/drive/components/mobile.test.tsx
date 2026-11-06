import { AlertSoundController } from '@antler/alert-ui'
import type { Lang } from '@antler/schema'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { DriveEngine } from '../domain/engine'
import { driveLook } from '../domain/look-input'
import { demoScenario } from '../domain/scenario'
import { ZONES } from '../domain/zones-data'
import { requestGyroPermission } from '../hooks/gyro-permission'
import { DrivePage } from './DrivePage'
import { LANGS, MOBILE_TEXT } from './mobile-text'
import { RotateGuide } from './RotateGuide'

// docs/specs/mobile-landscape/functional.md の画面の振る舞い（R1〜R4）。
// matchMedia は jsdom に無いので、指で操る端末か・縦かを切り替えられる偽物を置く。

const here = dirname(fileURLToPath(import.meta.url))
const driveCss = readFileSync(resolve(here, 'drive.css'), 'utf8')
const chatCss = readFileSync(resolve(here, '../chat/chat-feed.css'), 'utf8')

type Media = { coarse: boolean; portrait: boolean }
const media: Media = { coarse: false, portrait: false }
const lists = new Map<string, { listeners: Set<() => void> }>()

function matches(query: string): boolean {
  if (query === '(any-pointer: coarse)' || query === '(pointer: coarse)') return media.coarse
  if (query === '(pointer: coarse) and (orientation: portrait)')
    return media.coarse && media.portrait
  return false
}

function stubMatchMedia() {
  lists.clear()
  vi.stubGlobal('matchMedia', (query: string) => {
    let entry = lists.get(query)
    if (!entry) {
      entry = { listeners: new Set() }
      lists.set(query, entry)
    }
    const { listeners } = entry
    return {
      get matches() {
        return matches(query)
      },
      media: query,
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    }
  })
}

function setMedia(next: Partial<Media>) {
  Object.assign(media, next)
  act(() => {
    for (const { listeners } of lists.values()) listeners.forEach((l) => l())
  })
}

function setup() {
  const engine = new DriveEngine(demoScenario(ZONES, ''), ZONES)
  const canvas = () => <div data-testid="scene" />
  vi.spyOn(AlertSoundController.prototype, 'unlock').mockResolvedValue(true)
  renderWithProviders(<DrivePage createEngine={() => engine} canvas={canvas} webgl2={() => true} />)
  return { engine }
}

const START = '出発（音を出します）'

/** 左の円の箱を 120px の円（中心 (72, 330)）にする */
function stickAt(el: HTMLElement) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(12, 270, 120, 120))
  return { cx: 72, cy: 330 }
}

function pointer(el: HTMLElement, type: string, init: Record<string, number> = {}) {
  const make = {
    down: fireEvent.pointerDown,
    move: fireEvent.pointerMove,
    up: fireEvent.pointerUp,
    cancel: fireEvent.pointerCancel,
  }[type]
  make?.(el, { pointerId: 1, pointerType: 'touch', ...init })
}

beforeEach(() => {
  media.coarse = false
  media.portrait = false
  stubMatchMedia()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  driveLook.reset()
})

describe('受け入れ（mobile-landscape）', () => {
  it('MLAC-1: 指の端末で出発すると左右の円が出て加速・ブレーキが入り、キーの説明は出ない。縦にすると 4 言語の案内と一時停止', async () => {
    media.coarse = true
    const { engine } = setup()
    await userEvent.click(screen.getByRole('button', { name: START }))
    expect(screen.queryByTestId('key-hints')).not.toBeInTheDocument()
    const stick = screen.getByRole('group', { name: MOBILE_TEXT.ja.stick.aria })
    const { cx, cy } = stickAt(stick)
    pointer(stick, 'down', { clientX: cx, clientY: cy })
    pointer(stick, 'move', { clientX: cx, clientY: cy - 50 })
    expect(engine.world.input.throttle).toBe(true)
    const brake = screen.getByRole('button', { name: MOBILE_TEXT.ja.brake.aria })
    pointer(brake, 'down', { pointerId: 2 })
    expect(engine.world.input.brake).toBe(true)
    expect(engine.world.input.throttle).toBe(true)

    setMedia({ portrait: true })
    const guide = screen.getByTestId('rotate-guide')
    for (const lang of LANGS) expect(guide).toHaveTextContent(MOBILE_TEXT[lang].rotate.title)
    expect(engine.getSnapshot().playback.paused).toBe(true)
    // 縦の間は円を出さず、指の入力を離す
    expect(screen.queryByTestId('touch-stick')).not.toBeInTheDocument()
    expect(engine.world.input.throttle).toBe(false)
    expect(engine.world.input.brake).toBe(false)
  })
})

describe('配置（R1。CSS の決まり）', () => {
  const rule = (css: string, head: string) => {
    const at = css.indexOf(head)
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at))
  }
  const media = (css: string, query: string) => {
    const blocks: string[] = []
    let at = css.indexOf(`@media ${query} {`)
    while (at >= 0) {
      const next = css.indexOf('\n}\n', at)
      blocks.push(css.slice(at, next < 0 ? undefined : next))
      at = css.indexOf(`@media ${query} {`, at + 1)
    }
    return blocks.join('\n')
  }
  const SMALL = '(max-width: 1100px), (max-height: 560px)'
  const LOW = '(max-height: 560px)'

  it('ML-1a: 小さい画面で右の列・左の列・端の余白を詰める。大きい画面の右の列は 360px のまま', () => {
    expect(rule(driveCss, '.drive {')).toMatch(/--drive-chat-w:\s*360px/)
    const small = media(driveCss, SMALL)
    expect(small).toMatch(/--drive-chat-w:\s*min\(260px,\s*30vw\)/)
    expect(small).toMatch(/--drive-left-w:\s*240px/)
    expect(small).toMatch(/--drive-edge:\s*var\(--space-3\)/)
    // 右の列の余白も同じ変数
    expect(media(chatCss, SMALL)).toMatch(/right:\s*var\(--drive-edge\)/)
  })

  it('ML-1b: 上の帯は左の列の右端と右の列の左端の間（translateX で中央に寄せない）', () => {
    const top = rule(driveCss, '.drive-hud__top {')
    expect(top).toMatch(/left:\s*calc\(var\(--drive-edge\) \+ var\(--drive-left-w\)/)
    expect(top).toMatch(/right:\s*calc\(var\(--drive-chat-w\)/)
    expect(top).not.toMatch(/translateX/)
    expect(rule(driveCss, '.drive-hud__left {')).toMatch(/max-width:\s*var\(--drive-left-w\)/)
  })

  it('ML-1c: 出発の案内・終了の帯は画面の高さに収まり、中でスクロールする', () => {
    const box = rule(driveCss, '.drive-hud__end,\n.drive-start {')
    expect(box).toMatch(/max-height:\s*calc\(100% - var\(--drive-edge\) \* 2\)/)
    expect(box).toMatch(/overflow-y:\s*auto/)
    // 低い画面では「出発」を下に留める
    expect(media(driveCss, LOW)).toMatch(/position:\s*sticky/)
  })

  it('ML-1d: 車内のスマホ（drei の Html）は .drive__scene の重なりの文脈に閉じこめる', () => {
    expect(rule(driveCss, '.drive__scene {')).toMatch(/z-index:\s*0/)
  })

  it('ML-1e: 低い画面ではおすすめの一言を出さず、カードを列の 45% までにする', () => {
    expect(media(driveCss, LOW)).toMatch(/\.drive-recommend__note\s*\{\s*display:\s*none/)
    expect(media(chatCss, LOW)).toMatch(/\.drive-recommend\s*\{\s*max-height:\s*45%/)
  })
})

describe('縦画面の案内（R2）', () => {
  it('ML-2a: 指の端末で縦のときに案内（アイコンは SVG）。横・マウスでは出ない', () => {
    media.coarse = true
    media.portrait = true
    setup()
    const guide = screen.getByTestId('rotate-guide')
    expect(guide).toHaveAttribute('role', 'alert')
    expect(guide.querySelector('svg')).not.toBeNull()
    setMedia({ portrait: false })
    expect(screen.queryByTestId('rotate-guide')).not.toBeInTheDocument()
    // マウスの細長いウィンドウ（縦）では出さない
    setMedia({ coarse: false, portrait: true })
    expect(screen.queryByTestId('rotate-guide')).not.toBeInTheDocument()
  })

  it('ML-2b: 主文は旅の言語、副文に残り 3 言語', () => {
    for (const lang of LANGS) {
      const { unmount } = render(<RotateGuide lang={lang} />)
      const guide = screen.getByTestId('rotate-guide')
      const title = guide.querySelector('.drive-rotate__title')
      expect(title).toHaveTextContent(MOBILE_TEXT[lang].rotate.title)
      expect(title).toHaveAttribute('lang', lang)
      const others = [...guide.querySelectorAll('.drive-rotate__others li')].map((li) =>
        li.getAttribute('lang'),
      )
      expect(others.sort()).toEqual(LANGS.filter((l: Lang) => l !== lang).sort())
      unmount()
    }
  })

  it('ML-2d: 縦の案内の間は、下の画面（出発の案内のボタンなど）が inert で Tab・読み上げに届かない', () => {
    media.coarse = true
    setup()
    const content = document.querySelector('.drive__content') as HTMLElement
    // jsdom には inert のプロパティが無いので属性で見る
    expect(content).not.toHaveAttribute('inert')
    setMedia({ portrait: true })
    expect(content).toHaveAttribute('inert')
    expect(content.contains(screen.getByRole('button', { name: START, hidden: true }))).toBe(true)
    expect(content.contains(screen.getByTestId('rotate-guide'))).toBe(false)
  })

  it('ML-2c: 走っている途中で縦になったら一時停止（横に戻しても再開しない）。出発前は止めない', async () => {
    media.coarse = true
    const { engine } = setup()
    setMedia({ portrait: true })
    expect(engine.getSnapshot().playback.paused).toBe(false)
    setMedia({ portrait: false })
    await userEvent.click(screen.getByRole('button', { name: START }))
    setMedia({ portrait: true })
    expect(engine.getSnapshot().playback.paused).toBe(true)
    setMedia({ portrait: false })
    expect(engine.getSnapshot().playback.paused).toBe(true)
  })
})

describe('指の操作（R3）', () => {
  async function started() {
    media.coarse = true
    const out = setup()
    await userEvent.click(screen.getByRole('button', { name: START }))
    const stick = screen.getByTestId('touch-stick')
    return { ...out, stick, ...stickAt(stick) }
  }

  it('ML-3b: 離す・pointercancel・window の blur で全部離す。2 本目の指は無視する', async () => {
    const { engine, stick, cx, cy } = await started()
    pointer(stick, 'down', { clientX: cx, clientY: cy })
    pointer(stick, 'move', { clientX: cx - 50, clientY: cy - 50 })
    expect(engine.world.input).toMatchObject({ left: true, throttle: true })
    // 2 本目の指は使わない
    pointer(stick, 'down', { pointerId: 9, clientX: cx + 50, clientY: cy + 50 })
    pointer(stick, 'move', { pointerId: 9, clientX: cx + 50, clientY: cy + 50 })
    expect(engine.world.input).toMatchObject({ left: true, right: false, throttle: true })
    pointer(stick, 'up', { pointerId: 9 })
    expect(engine.world.input.throttle).toBe(true)
    pointer(stick, 'up')
    expect(engine.world.input).toMatchObject({ left: false, throttle: false })

    pointer(stick, 'down', { clientX: cx, clientY: cy + 50 })
    expect(engine.world.input.back).toBe(true)
    pointer(stick, 'cancel')
    expect(engine.world.input.back).toBe(false)

    pointer(stick, 'down', { clientX: cx + 50, clientY: cy })
    expect(engine.world.input.right).toBe(true)
    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(engine.world.input.right).toBe(false)
  })

  it('ML-3c: 右の円を押している間だけブレーキ', async () => {
    const { engine } = await started()
    const brake = screen.getByTestId('touch-brake')
    expect(brake).toHaveAttribute('aria-pressed', 'false')
    pointer(brake, 'down', { pointerId: 3 })
    expect(engine.world.input.brake).toBe(true)
    expect(brake).toHaveAttribute('aria-pressed', 'true')
    pointer(brake, 'up', { pointerId: 3 })
    expect(engine.world.input.brake).toBe(false)
  })

  it('ML-3d: キーと指の入力は合わさる（指を離してもキーの押下は残る）', async () => {
    const { engine, stick, cx, cy } = await started()
    const user = userEvent.setup()
    await user.keyboard('[KeyW>]')
    pointer(stick, 'down', { clientX: cx - 50, clientY: cy })
    expect(engine.world.input).toMatchObject({ throttle: true, left: true })
    pointer(stick, 'up')
    expect(engine.world.input).toMatchObject({ throttle: true, left: false })
    await user.keyboard('[/KeyW]')
    expect(engine.world.input.throttle).toBe(false)
  })

  it('ML-3e: 円は指の端末で走っている間だけ。マウスではキーの説明が出て円は出ない', async () => {
    media.coarse = true
    setup()
    expect(screen.queryByTestId('touch-stick')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: START }))
    expect(screen.getByTestId('touch-stick')).toBeInTheDocument()
    expect(screen.getByTestId('touch-brake')).toHaveAccessibleName(MOBILE_TEXT.ja.brake.aria)
    // 途中でマウスだけになったら円を消し、キーの説明を出す
    setMedia({ coarse: false })
    expect(screen.queryByTestId('touch-stick')).not.toBeInTheDocument()
    expect(screen.getByTestId('key-hints')).toBeInTheDocument()
  })

  it('ML-3f: 出発の案内の操作の説明は、指の端末では円とスマホの向き', () => {
    media.coarse = true
    setup()
    const hints = screen.getByTestId('start-controls')
    for (const [key, label] of [...MOBILE_TEXT.ja.hints, MOBILE_TEXT.ja.lookGyro]) {
      expect(hints).toHaveTextContent(key)
      expect(hints).toHaveTextContent(label)
    }
    expect(hints).not.toHaveTextContent('Space')
  })
})

describe('ジャイロの許可（R4）', () => {
  it('ML-4d: granted か関数が無いときだけ true。denied・reject・例外・センサーなしは false', async () => {
    const ok = vi.fn().mockResolvedValue('granted')
    expect(await requestGyroPermission({ DeviceOrientationEvent: { requestPermission: ok } })).toBe(
      true,
    )
    expect(await requestGyroPermission({ DeviceOrientationEvent: {} })).toBe(true)
    expect(
      await requestGyroPermission({
        DeviceOrientationEvent: { requestPermission: vi.fn().mockResolvedValue('denied') },
      }),
    ).toBe(false)
    expect(
      await requestGyroPermission({
        DeviceOrientationEvent: { requestPermission: vi.fn().mockRejectedValue(new Error('x')) },
      }),
    ).toBe(false)
    expect(
      await requestGyroPermission({
        DeviceOrientationEvent: {
          requestPermission: () => {
            throw new Error('not allowed')
          },
        },
      }),
    ).toBe(false)
    expect(await requestGyroPermission({})).toBe(false)
  })

  it('ML-4d: 「出発」の操作の中で同期的に許可を聞き、待たずに走り出す。granted なら向きを視線に使う', async () => {
    media.coarse = true
    let grant: (state: string) => void = () => undefined
    const requestPermission = vi.fn(
      () =>
        new Promise<string>((done) => {
          grant = done
        }),
    )
    vi.stubGlobal('DeviceOrientationEvent', Object.assign(class {}, { requestPermission }))
    setup()
    await userEvent.click(screen.getByRole('button', { name: START }))
    expect(requestPermission).toHaveBeenCalledTimes(1)
    // 許可のダイアログの間も走れる
    expect(screen.getByTestId('touch-stick')).toBeInTheDocument()
    const orient = (alpha: number) =>
      act(() => {
        window.dispatchEvent(
          Object.assign(new Event('deviceorientation'), { alpha, beta: 90, gamma: 0 }),
        )
      })
    orient(0)
    expect(driveLook.gyro.target(performance.now())).toBeNull()
    await act(async () => {
      grant('granted')
      await Promise.resolve()
    })
    orient(0)
    orient(354)
    expect(driveLook.gyro.target(performance.now())?.x).toBeCloseTo(0.5, 1)
  })

  it('ML-4d: denied なら向きを聞かない（ドラッグ・カーソルの視線のまま）', async () => {
    media.coarse = true
    vi.stubGlobal(
      'DeviceOrientationEvent',
      Object.assign(class {}, { requestPermission: vi.fn().mockResolvedValue('denied') }),
    )
    setup()
    await userEvent.click(screen.getByRole('button', { name: START }))
    await act(async () => {
      await Promise.resolve()
    })
    act(() => {
      window.dispatchEvent(
        Object.assign(new Event('deviceorientation'), { alpha: 0, beta: 90, gamma: 0 }),
      )
    })
    expect(driveLook.gyro.target(performance.now())).toBeNull()
  })

  it('ML-4f: 出発の案内でジャイロの視線を切れる（OFF なら許可を聞かず、説明はドラッグ）。マウスの端末には出さない', async () => {
    media.coarse = true
    const requestPermission = vi.fn().mockResolvedValue('granted')
    vi.stubGlobal('DeviceOrientationEvent', Object.assign(class {}, { requestPermission }))
    setup()
    const toggle = screen.getByRole('button', { name: MOBILE_TEXT.ja.gyro })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('start-controls')).toHaveTextContent(MOBILE_TEXT.ja.lookDrag[0])
    await userEvent.click(screen.getByRole('button', { name: START }))
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('ML-4f: マウスの端末にはジャイロの切り替えを出さない', () => {
    setup()
    expect(screen.queryByRole('button', { name: MOBILE_TEXT.ja.gyro })).not.toBeInTheDocument()
  })

  it('ML-4e: ジャイロが無いとき、運転画面を指でドラッグすると視線が動き、離すと正面に戻る', async () => {
    media.coarse = true
    setup()
    await userEvent.click(screen.getByRole('button', { name: START }))
    const scene = document.querySelector('.drive__scene') as HTMLElement
    Object.defineProperty(scene, 'clientWidth', { value: 800, configurable: true })
    Object.defineProperty(scene, 'clientHeight', { value: 400, configurable: true })
    const cursor = { x: 0.9, y: 0.9 }
    pointer(scene, 'down', { pointerId: 4, clientX: 400, clientY: 200 })
    pointer(scene, 'move', { pointerId: 4, clientX: 600, clientY: 100 })
    expect(driveLook.target(cursor, 0)).toEqual({ x: 0.5, y: 0.5 })
    pointer(scene, 'up', { pointerId: 4 })
    expect(driveLook.target(cursor, 0)).toEqual({ x: 0, y: 0 })
    // マウスを動かすとカーソルに戻る
    fireEvent.pointerMove(scene, { pointerId: 5, pointerType: 'mouse' })
    expect(driveLook.target(cursor, 0)).toEqual(cursor)
  })
})
