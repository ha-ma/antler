import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AudioControls } from './AudioControls'
import type { AudioGraphPort } from './audio-graph'
import { AudioSettingsStore } from './audio-settings'
import { defaultCreateGraph, useDriveAudio } from './use-drive-audio'

function fakeGraph(): AudioGraphPort {
  return {
    resume: vi.fn(() => Promise.resolve()),
    suspend: vi.fn(() => Promise.resolve()),
    currentTime: () => 0,
    setLevels: vi.fn(),
    setMusic: vi.fn(),
    onMusicEvent: vi.fn(),
    loadSamples: vi.fn(),
    playSqueal: vi.fn(),
    playCrash: vi.fn(),
    playNotify: vi.fn(),
    close: vi.fn(),
  }
}

describe('音量の操作（R14）', () => {
  it('CHAT-4i: 消音（aria-pressed）・音量のスライダー（0〜100、10 きざみ）・ラジオ（aria-pressed）を出し、押すと設定が変わる', async () => {
    const user = userEvent.setup()
    const settings = new AudioSettingsStore(null)
    render(<AudioControls settings={settings} lang="ja" />)
    const group = screen.getByRole('group', { name: '運転の音（鹿の警告の音は別）' })
    expect(group).toBeInTheDocument()
    const mute = screen.getByRole('button', { name: '運転の音を消す' })
    const slider = screen.getByRole('slider', { name: '運転の音の大きさ' })
    const radio = screen.getByRole('button', { name: 'ラジオ' })
    expect(mute).toHaveAttribute('aria-pressed', 'false')
    expect(radio).toHaveAttribute('aria-pressed', 'true')
    expect(slider).toHaveAttribute('min', '0')
    expect(slider).toHaveAttribute('max', '100')
    expect(slider).toHaveAttribute('step', '10')
    expect(slider).toHaveValue('60')

    await user.click(mute)
    expect(settings.getSnapshot().muted).toBe(true)
    expect(mute).toHaveAttribute('aria-pressed', 'true')
    expect(slider).toBeDisabled()
    await user.click(mute)
    await user.click(radio)
    expect(settings.getSnapshot().music).toBe(false)
    expect(radio).toHaveAttribute('aria-pressed', 'false')

    act(() => settings.setVolume(30))
    expect(slider).toHaveValue('30')
    expect(slider).toHaveAttribute('aria-valuetext', '30%')
  })

  it('CHAT-4i: 4 言語のラベル', () => {
    const settings = new AudioSettingsStore(null)
    const { rerender } = render(<AudioControls settings={settings} lang="en" />)
    expect(screen.getByRole('button', { name: 'Mute driving sounds' })).toBeInTheDocument()
    rerender(<AudioControls settings={settings} lang="zh" />)
    expect(screen.getByRole('slider', { name: '駕駛音效音量' })).toBeInTheDocument()
    rerender(<AudioControls settings={settings} lang="ko" />)
    expect(screen.getByRole('button', { name: '라디오' })).toBeInTheDocument()
  })
})

describe('音の持ち手（R1・R7）', () => {
  it('AUD-3a: 開発中（VITE_GAME_AUDIO なし）は音のグラフを作らない', () => {
    expect(import.meta.env.DEV).toBe(true)
    expect(defaultCreateGraph()).toBeNull()
  })

  it('AUD-3h: タブを隠すと止め、画面を離れると閉じる。片づけの後の start で作り直す', async () => {
    const graphs: AudioGraphPort[] = []
    const create = () => {
      const g = fakeGraph()
      graphs.push(g)
      return g
    }
    const { result, unmount } = renderHook(() => useDriveAudio(3, create))
    await act(() => result.current.audio.start())
    expect(graphs).toHaveLength(1)
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(graphs[0]?.suspend).toHaveBeenCalledTimes(1)
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(graphs[0]?.resume).toHaveBeenCalledTimes(2)
    const { audio } = result.current
    unmount()
    expect(graphs[0]?.close).toHaveBeenCalledTimes(1)
    await audio.start()
    expect(graphs).toHaveLength(2)
  })
})
