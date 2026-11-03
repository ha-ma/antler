import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { FakeSocket } from '@/test/fake-socket'
import { App } from './App'

describe('App', () => {
  beforeEach(() => {
    FakeSocket.reset()
    vi.stubGlobal('WebSocket', FakeSocket)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('起動すると B-0 を出し、車載の WebSocket に 1 本だけつなぐ', () => {
    render(<App />)
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('button')).toBeInTheDocument()
    expect(FakeSocket.instances).toHaveLength(1)
    expect(FakeSocket.last.url).toBe('ws://ezoroad.local:8765/alerts')
  })
})
