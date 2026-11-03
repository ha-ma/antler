import { describe, expect, it } from 'vitest'
import { alertSoundEnabled, SilentAudioPort } from './silent-audio'

describe('開発中はアラートの音を出さない', () => {
  it('UC-7i: 本番は常に鳴らす。開発は VITE_ALERT_SOUND=on のときだけ鳴らす', () => {
    expect(alertSoundEnabled({ DEV: false })).toBe(true)
    expect(alertSoundEnabled({ DEV: false, VITE_ALERT_SOUND: 'off' })).toBe(true)
    expect(alertSoundEnabled({ DEV: true })).toBe(false)
    expect(alertSoundEnabled({ DEV: true, VITE_ALERT_SOUND: 'on' })).toBe(true)
  })

  it('UC-7i: 無音の出力先は解除に成功し、何を呼んでも例外にならない', async () => {
    const port = new SilentAudioPort()
    await expect(port.unlock()).resolves.toBeUndefined()
    expect(() => {
      port.playChime()
      port.playBeep()
      port.speak()
      port.cancelSpeech()
    }).not.toThrow()
  })
})
