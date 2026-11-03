import { render, screen } from '@testing-library/react'
import { App } from './App'

describe('App', () => {
  it('main ランドマークと見出しを出す', () => {
    render(<App />)
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'EZO ROAD' })).toBeInTheDocument()
  })
})
