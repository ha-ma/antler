import { AlertSoundController } from '@antler/alert-ui'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DriveEngine } from '../domain/engine'
import { demoScenario } from '../domain/scenario'
import { ZONES } from '../domain/zones-data'
import { renderWithProviders } from '@/test/render'
import { DriveAudio } from '../audio/drive-audio'
import { DrivePage } from './DrivePage'

// 3D（DriveCanvas）は jsdom で描けないので、フレームの呼び出しだけを受ける偽物に差し替える。
// HUD（車内のスマホ・会話・おすすめのカード・音量の操作）は本物を描く。
type SceneProps = { onFrame: (dt: number) => void }

function setup(search = '') {
  const engine = new DriveEngine(demoScenario(ZONES, search), ZONES)
  const frames: { onFrame: (dt: number) => void } = { onFrame: () => undefined }
  const canvas = ({ onFrame }: SceneProps) => {
    frames.onFrame = onFrame
    return <div data-testid="scene" />
  }
  const unlock = vi.spyOn(AlertSoundController.prototype, 'unlock').mockResolvedValue(true)
  renderWithProviders(<DrivePage createEngine={() => engine} canvas={canvas} webgl2={() => true} />)
  return { engine, frames, unlock }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('運転の音と車内の会話の組み込み（drive-audio-chat）', () => {
  it('CHAT-4m: 「出発」「もう一度」で運転の音を鳴らし始め、HUD の右の列に会話と音量の操作が出る', async () => {
    const start = vi.spyOn(DriveAudio.prototype, 'start')
    const { engine, frames } = setup()
    expect(start).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '出発（音を出します）' }))
    expect(start).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('log', { name: '車内の会話' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '運転の音（鹿の警告の音は別）' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: '運転の音の大きさ' })).toBeInTheDocument()
    // 道のりが会話の行を越えると、見本の会話が出る（見本の運転は api を呼ばない）
    const { vehicle, plan } = engine.world
    engine.world.vehicle = { ...vehicle, s: Math.min(plan.totalKm * 1000 - 10, vehicle.s + 25_000) }
    act(() => frames.onFrame(200))
    await waitFor(() => {
      expect(document.querySelectorAll('.drive-chat__line').length).toBeGreaterThan(0)
    })
    engine.restart()
    expect(engine.world.t).toBe(0)
  })

  it('CHAT-4m: 音量のスライダーにフォーカスがあるとき、矢印キーで運転しない（a11y C1）', async () => {
    const { engine } = setup()
    await userEvent.click(screen.getByRole('button', { name: '出発（音を出します）' }))
    const slider = screen.getByRole('slider', { name: '運転の音の大きさ' })
    slider.focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(engine.world.input.left).toBe(false)
    slider.blur()
    await userEvent.keyboard('{ArrowLeft>}')
    expect(engine.world.input.left).toBe(true)
    await userEvent.keyboard('{/ArrowLeft}')
  })
})

describe('観光の楽しみ（drive-tourism）', () => {
  it('AC-2・UC-4e: ゾーンの手前でおすすめのカードが右の列の音量の操作の上に出て、ゾーンに入ると消え、同じステージでは出し直さない', async () => {
    const { engine, frames } = setup()
    await userEvent.click(screen.getByRole('button', { name: '出発（音を出します）' }))
    // ステージはゾーンの 1 km 手前から始まる（drive-crash-spot R1）。帯が無いので走り出すとすぐ出る
    const card = screen.getByTestId('recommend-card')
    expect(card).toHaveAccessibleName('この先のおすすめ')
    // 見本の場面（2 月の釧路 → 阿寒湖、立ち寄りなし）は到着地の楽しみ
    expect(card).toHaveTextContent('阿寒湖')
    const column = card.closest('.drive-chat-column')
    const audio = screen.getByRole('group', { name: '運転の音（鹿の警告の音は別）' })
    expect(column).not.toBeNull()
    expect(column?.contains(audio)).toBe(true)
    // カードは会話の後・音量の操作の前（右下、音量の上）
    expect(card.compareDocumentPosition(audio) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(card).queryAllByRole('button')).toHaveLength(0)
    expect(within(card).queryAllByRole('link')).toHaveLength(0)

    const entryM = (engine.world.plan.intervals[0]?.entryKm ?? 0) * 1000
    engine.world.vehicle = { ...engine.world.vehicle, s: entryM + 50 }
    act(() => frames.onFrame(150))
    expect(screen.queryByTestId('recommend-card')).toBeNull()
    // 同じステージでゾーンの外に戻っても出し直さない
    engine.world.vehicle = { ...engine.world.vehicle, s: entryM - 500 }
    act(() => frames.onFrame(150))
    expect(screen.queryByTestId('recommend-card')).toBeNull()
  })

  it('AC-2: 見本の会話の楽しみの行が右上の会話に写真と出典つきで出る', async () => {
    const { engine, frames } = setup()
    await userEvent.click(screen.getByRole('button', { name: '出発（音を出します）' }))
    const { vehicle, plan } = engine.world
    engine.world.vehicle = { ...vehicle, s: Math.min(plan.totalKm * 1000 - 10, vehicle.s + 25_000) }
    act(() => frames.onFrame(200))
    await waitFor(() => {
      expect(document.querySelector('.drive-chat__photo')).not.toBeNull()
    })
    expect(document.querySelector('.drive-chat__photo')).toHaveAttribute('alt', '')
    expect(document.querySelector('.drive-chat__credit')?.textContent).toMatch(/^写真: .+ \/ .+$/)
  })
})

describe('drive の画面（R7・R8・R12）', () => {
  it('UC-7e: 「出発」ボタンで音の unlock() を呼んでから走り出す（押すまではフレームで進まない）', async () => {
    const { engine, frames, unlock } = setup()
    act(() => frames.onFrame(100))
    expect(engine.world.t).toBe(0)
    await userEvent.click(screen.getByRole('button', { name: '出発（音を出します）' }))
    expect(unlock).toHaveBeenCalledTimes(1)
    act(() => frames.onFrame(50))
    expect(engine.world.t).toBeGreaterThan(0)
    expect(screen.getByTestId('zone-status')).toHaveTextContent('次の鹿ゾーンまで')
  })

  it('UC-7c: アラート OFF ではスマホの AlertState を描かず、左上のゾーン状態は区間の中で琥珀', async () => {
    const { engine, frames } = setup('?alert=off')
    await userEvent.click(screen.getByRole('button', { name: '出発（音を出します）' }))
    expect(document.querySelector('[data-alert-state]')).toBeNull()
    engine.world.vehicle = {
      ...engine.world.vehicle,
      s: (engine.world.plan.intervals[0]?.entryKm ?? 0) * 1000 + 50,
    }
    act(() => frames.onFrame(150))
    expect(screen.getByTestId('zone-status')).toHaveAttribute('data-state', 'zone')
    expect(document.querySelector('[data-alert-state]')).toBeNull()
    expect(screen.queryByTestId('danger-banner')).toBeNull()
  })

  it('UC-7c: アラート ON ではスマホに AlertState（compact）を描く', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: '出発（音を出します）' }))
    expect(document.querySelector('[data-alert-state]')).toHaveAttribute('data-compact', 'true')
  })

  it('UC-7g: 終わりの帯の「同じシードでもう一度」で最初からやり直し、音のコントローラを作り直して unlock() する', async () => {
    const { engine, frames, unlock } = setup()
    await userEvent.click(screen.getByRole('button', { name: '出発（音を出します）' }))
    // 最後のステージの出口の手前に置く（その出口を抜けると完走。drive-tune R1）
    const stages = engine.world.internal.stages
    engine.world.internal.stageIndex = stages.length - 1
    engine.world.vehicle = {
      ...engine.world.vehicle,
      s: (stages[stages.length - 1]?.exitM ?? 0) - 1.5,
      speed: 20,
    }
    act(() => frames.onFrame(100))
    expect(screen.getByRole('heading', { name: '完走しました' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '同じシードでもう一度' }))
    expect(unlock).toHaveBeenCalledTimes(2)
    expect(engine.world.vehicle.s).toBe(engine.world.internal.stages[0]?.startM)
    expect(engine.world.internal.stageIndex).toBe(0)
    expect(screen.queryByRole('heading', { name: '完走しました' })).toBeNull()
  })

  it('[component-guard W3・W4] Cmd つきのキーでは運転しない。Cmd を離すと全部離したことにする。マウスで押したボタンはフォーカスを外す', async () => {
    const { engine } = setup()
    await userEvent.click(screen.getByRole('button', { name: '出発（音を出します）' }))
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', metaKey: true }))
    })
    expect(engine.world.input.left).toBe(false)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }))
    })
    expect(engine.world.input.throttle).toBe(true)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta', code: 'MetaLeft' }))
    })
    expect(engine.world.input.throttle).toBe(false)
    const fast = screen.getByRole('button', { name: '4×' })
    await userEvent.click(fast)
    expect(document.activeElement).not.toBe(fast)
  })

  it('UC-7b: 音トグル OFF・一時停止で、スマホの AlertState から音のコントローラへ muted を渡す', async () => {
    const update = vi.spyOn(AlertSoundController.prototype, 'update')
    setup()
    await userEvent.click(screen.getByRole('button', { name: '出発（音を出します）' }))
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ muted: false }))
    await userEvent.click(screen.getByRole('button', { name: '音 ON' }))
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ muted: true }))
    await userEvent.click(screen.getByRole('button', { name: '音 OFF' }))
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ muted: false }))
    await userEvent.click(screen.getByRole('button', { name: '一時停止' }))
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ muted: true }))
  })

  it('UC-4f: ステージを移るときに音のコントローラを作り直す（2 つ目のゾーンでもチャイムが鳴る。drive-tune R1）', async () => {
    const { engine, frames, unlock } = setup()
    await userEvent.click(screen.getByRole('button', { name: '出発（音を出します）' }))
    expect(unlock).toHaveBeenCalledTimes(1)
    const first = engine.world.internal.stages[0]
    if (!first) throw new Error('ステージがない')
    engine.world.vehicle = { ...engine.world.vehicle, s: first.exitM - 1, speed: 20 }
    act(() => frames.onFrame(100))
    expect(engine.world.internal.stageIndex).toBe(1)
    await waitFor(() => expect(unlock).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('stage-banner')).toHaveTextContent('ステージ 1 / 2 クリア')
  })

  it('UC-7h: WebGL2 が使えなければ 3D を出さずに案内を出す', () => {
    renderWithProviders(
      <DrivePage webgl2={() => false} canvas={() => <div data-testid="scene" />} />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('WebGL2 が必要です')
    expect(screen.queryByTestId('scene')).toBeNull()
  })

  it('HUD-1: 運転の画面の main は旅の言語の lang を持つ（zh は zh-Hant。a11y C-1）', () => {
    setup('?lang=zh')
    expect(document.querySelector('main.drive')).toHaveAttribute('lang', 'zh-Hant')
    expect(screen.getByRole('button', { name: '出發（會播放聲音）' })).toBeInTheDocument()
  })
})
