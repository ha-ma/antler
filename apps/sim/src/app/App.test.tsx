import { render, screen } from '@testing-library/react'
import { createMemoryRouter } from 'react-router'
import { App } from './App'
import { routes } from './routes'

describe('App', () => {
  it('`/` は A-1（/plan）に移り、main ランドマークと見出しを出す', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/'] })
    render(<App router={router} />)
    expect(await screen.findByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/plan')
    expect(screen.getByText('EZO ROAD')).toBeInTheDocument()
  })

  it('知らないパスも /plan に移る', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/nowhere'] })
    render(<App router={router} />)
    await screen.findByRole('main')
    expect(router.state.location.pathname).toBe('/plan')
  })
})
