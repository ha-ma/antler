import { render, screen } from '@testing-library/react'
import { AppErrorBoundary } from './AppErrorBoundary'

function Boom(): never {
  throw new Error('boom')
}

describe('AppErrorBoundary', () => {
  it('子の例外を受け止め、スタックトレースを見せずに案内を出して JSON で記録する', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('読み込み直して')
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument()
    const logged = error.mock.calls
      .map(([line]) => (typeof line === 'string' && line.startsWith('{') ? JSON.parse(line) : null))
      .find((entry) => entry?.event === 'react.render')
    expect(logged?.error.message).toBe('boom')
    error.mockRestore()
  })

  it('例外が無ければ子をそのまま出す', () => {
    render(
      <AppErrorBoundary>
        <p>ok</p>
      </AppErrorBoundary>,
    )
    expect(screen.getByText('ok')).toBeInTheDocument()
  })
})
