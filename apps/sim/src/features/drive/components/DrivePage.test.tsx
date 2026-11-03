import { AlertSoundController } from '@antler/alert-ui'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DriveEngine } from '../domain/engine'
import { demoScenario } from '../domain/scenario'
import { ZONES } from '../domain/zones-data'
import { DrivePage } from './DrivePage'

// 3D（DriveCanvas）は jsdom で描けないので、スマホの中身とフレームの呼び出しだけを受ける偽物に差し替える。
type SceneProps = { phone: ReactNode; onFrame: (dt: number) => void }

function setup(search = '') {
  const engine = new DriveEngine(demoScenario(ZONES, search), ZONES)
  const frames: { onFrame: (dt: number) => void } = { onFrame: () => undefined }
  const canvas = ({ phone, onFrame }: SceneProps) => {
    frames.onFrame = onFrame
    return <div data-testid="phone">{phone}</div>
  }
  const unlock = vi.spyOn(AlertSoundController.prototype, 'unlock').mockResolvedValue(true)
  render(<DrivePage createEngine={() => engine} canvas={canvas} webgl2={() => true} />)
  return { engine, frames, unlock }
}

afterEach(() => {
  vi.restoreAllMocks()
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
    engine.world.vehicle = {
      ...engine.world.vehicle,
      s: engine.world.internal.frame.lengthM - 1.5,
      speed: 20,
    }
    act(() => frames.onFrame(100))
    expect(screen.getByRole('heading', { name: '完走しました' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '同じシードでもう一度' }))
    expect(unlock).toHaveBeenCalledTimes(2)
    expect(engine.world.vehicle.s).toBe(0)
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

  it('UC-7h: WebGL2 が使えなければ 3D を出さずに案内を出す', () => {
    render(<DrivePage webgl2={() => false} canvas={() => <div data-testid="scene" />} />)
    expect(screen.getByRole('alert')).toHaveTextContent('WebGL2 が必要です')
    expect(screen.queryByTestId('scene')).toBeNull()
  })
})
