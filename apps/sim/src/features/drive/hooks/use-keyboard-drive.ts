import { useEffect } from 'react'
import type { DriveEngine } from '../domain/engine'
import { NO_INPUT, type DriveInput } from '../types'

// キー入力（R3、A3-3）。W/S/A/D と Space。矢印キーも同じに扱う。
// 外部（window のキーイベント）の購読なので effect に隔離する（state-management.md「購読はカスタム hook に」）。

const KEYS: Record<string, keyof DriveInput> = {
  KeyW: 'throttle',
  ArrowUp: 'throttle',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'brake',
}

/** キーの押下をエンジンの入力にする。enabled が false の間は入力を空にする */
export function useKeyboardDrive(engine: DriveEngine, enabled: boolean): void {
  // eslint-disable-next-line no-restricted-syntax -- window のキーイベントの購読（外部イベント）
  useEffect(() => {
    if (!enabled) return undefined
    const input: DriveInput = { ...NO_INPUT }
    const apply = (code: string, pressed: boolean, e: KeyboardEvent) => {
      const key = KEYS[code]
      if (!key) return
      // ボタンにフォーカスがあるときの Space は、ボタンの操作に任せる
      if (code === 'Space' && e.target instanceof HTMLButtonElement) return
      e.preventDefault()
      if (input[key] === pressed) return
      input[key] = pressed
      engine.setInput({ ...input })
    }
    // フォーカスが外れたら離したことにする（押しっぱなしで走り続けない）
    const blur = () => {
      Object.assign(input, NO_INPUT)
      engine.setInput({ ...NO_INPUT })
    }
    // Cmd / Ctrl / Alt つきはブラウザのショートカットに任せる（Cmd+A などで運転しない）
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      apply(e.code, true, e)
    }
    const up = (e: KeyboardEvent) => {
      // macOS は Cmd を押している間ほかのキーの keyup を出さないので、Cmd を離したら全部離したことにする
      if (e.key === 'Meta') blur()
      else apply(e.code, false, e)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      engine.setInput({ ...NO_INPUT })
    }
  }, [engine, enabled])
}
