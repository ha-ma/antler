import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DriveEngine } from '../domain/engine'
import { demoScenario } from '../domain/scenario'
import { ZONES } from '../domain/zones-data'
import { FRAME_METER_MS, isFrameMeterOn } from '../hooks/use-frame-meter'
import { FrameMeter } from './FrameMeter'

// performance R2: /drive?fps=1 の開発用の fps の表示

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  window.history.replaceState(null, '', '/')
})

describe('開発用の fps の表示（performance R2）', () => {
  it('UC-2b: fps=1 のときだけ出す。ほかの値・無いときは出さない', () => {
    expect(isFrameMeterOn('?fps=1')).toBe(true)
    expect(isFrameMeterOn('?month=2&fps=1')).toBe(true)
    expect(isFrameMeterOn('?fps=0')).toBe(false)
    expect(isFrameMeterOn('?fps=true')).toBe(false)
    expect(isFrameMeterOn('')).toBe(false)

    window.history.replaceState(null, '', '/drive')
    const engine = new DriveEngine(demoScenario(ZONES), ZONES)
    render(<FrameMeter engine={engine} />)
    expect(screen.queryByTestId('frame-meter')).toBeNull()
  })

  it('UC-2c: 0.5 秒ごとにエンジンの要約を出し直す。読み上げない', () => {
    window.history.replaceState(null, '', '/drive?fps=1')
    const engine = new DriveEngine(demoScenario(ZONES), ZONES)
    render(<FrameMeter engine={engine} />)
    const meter = screen.getByTestId('frame-meter')
    expect(meter).toHaveAttribute('aria-hidden', 'true')
    expect(meter).toHaveTextContent('fps --')

    engine.frame(1000 / 60)
    engine.frame(55)
    // 次の取り直しまでは前の値のまま
    expect(meter).toHaveTextContent('fps --')
    act(() => {
      vi.advanceTimersByTime(FRAME_METER_MS)
    })
    expect(meter.textContent).toContain('drop 1 / 2')
  })
})
