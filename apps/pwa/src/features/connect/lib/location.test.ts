import { describe, expect, it, vi } from 'vitest'
import {
  requestLocationOnce,
  watchLocationState,
  type LocationDeps,
  type LocationState,
  type PermissionStatusLike,
} from './location'

function collect(deps: LocationDeps) {
  const states: LocationState[] = []
  const stop = watchLocationState(deps, (s) => states.push(s))
  return { states, stop }
}

function geo() {
  return { getCurrentPosition: vi.fn() }
}

describe('UC-6 位置の許可', () => {
  it('UC-6i: 安全なコンテキストでない・Geolocation が無い → insecure', () => {
    expect(
      collect({ isSecureContext: false, geolocation: geo(), permissions: undefined }).states,
    ).toEqual(['insecure'])
    expect(
      collect({ isSecureContext: true, geolocation: undefined, permissions: undefined }).states,
    ).toEqual(['insecure'])
  })

  it('UC-6f: permissions API が無い・例外でも落ちず unknown', async () => {
    expect(
      collect({ isSecureContext: true, geolocation: geo(), permissions: undefined }).states,
    ).toEqual(['unknown'])
    const failing = collect({
      isSecureContext: true,
      geolocation: geo(),
      permissions: { query: () => Promise.reject(new Error('x')) },
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(failing.states).toEqual(['unknown'])
  })

  it('UC-6i: 許可の変化（onchange）が反映され、解除すると止まる', async () => {
    const status: PermissionStatusLike = { state: 'prompt', onchange: null }
    const { states, stop } = collect({
      isSecureContext: true,
      geolocation: geo(),
      permissions: { query: () => Promise.resolve(status) },
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(states).toEqual(['prompt'])
    status.state = 'denied'
    status.onchange?.()
    expect(states).toEqual(['prompt', 'denied'])
    stop()
    expect(status.onchange).toBeNull()
  })

  it('UC-6e: prompt のとき getCurrentPosition を 1 回呼ぶ。granted・denied では呼ばない', () => {
    const g = geo()
    const deps: LocationDeps = { isSecureContext: true, geolocation: g, permissions: undefined }
    expect(requestLocationOnce(deps, 'granted')).toBe(false)
    expect(requestLocationOnce(deps, 'denied')).toBe(false)
    expect(requestLocationOnce(deps, 'insecure')).toBe(false)
    expect(g.getCurrentPosition).not.toHaveBeenCalled()
    expect(requestLocationOnce(deps, 'prompt')).toBe(true)
    expect(g.getCurrentPosition).toHaveBeenCalledTimes(1)
  })

  it('UC-6i: API が無くても Geolocation があれば出発で 1 回呼ぶ（unknown）。例外でも落ちない', () => {
    const g = geo()
    expect(
      requestLocationOnce(
        { isSecureContext: true, geolocation: g, permissions: undefined },
        'unknown',
      ),
    ).toBe(true)
    expect(g.getCurrentPosition).toHaveBeenCalledTimes(1)
    g.getCurrentPosition.mockImplementation(() => {
      throw new Error('boom')
    })
    expect(
      requestLocationOnce(
        { isSecureContext: true, geolocation: g, permissions: undefined },
        'unknown',
      ),
    ).toBe(false)
  })

  it('UC-6e: 座標の受け取りは何もしない（読まない・ログに出さない）', () => {
    const g = geo()
    requestLocationOnce({ isSecureContext: true, geolocation: g, permissions: undefined }, 'prompt')
    const [ok] = g.getCurrentPosition.mock.calls[0] as [(p: unknown) => void]
    expect(ok({ coords: { latitude: 43.0, longitude: 144.0 } })).toBeUndefined()
  })
})
