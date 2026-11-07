import { render, screen, waitFor } from '@testing-library/react'
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
  })

  it('BRAND-2: /plan のヘッダーに SHIKASHI SIMULATOR のロゴ、title の末尾は「| SHIKASHI SIMULATOR」', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/plan'] })
    render(<App router={router} />)
    const logo = await screen.findByRole('img', { name: 'SHIKASHI SIMULATOR' })
    expect(logo).toHaveAttribute('src', '/brand/shikashi-logo.png')
    await waitFor(() => {
      // 言語は端末に従う（jsdom は en）。ja では「旅をつくる | SHIKASHI SIMULATOR」
      expect(document.title).toMatch(/^(旅をつくる|Plan the trip) \| SHIKASHI SIMULATOR$/)
    })
  })

  it('知らないパスも /plan に移る', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/nowhere'] })
    render(<App router={router} />)
    await screen.findByRole('main')
    expect(router.state.location.pathname).toBe('/plan')
  })
})
