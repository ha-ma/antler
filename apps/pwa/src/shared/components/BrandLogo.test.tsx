import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BrandLogo } from './BrandLogo'

describe('BrandLogo（docs/specs/rebrand-shikashi R2）', () => {
  it('BRAND-8: 既定は夜のロゴ（28px）。alt は SHIKASHI NAVIGATOR、製品の行は aria-hidden', () => {
    render(<BrandLogo />)
    const logo = screen.getByRole('img', { name: 'SHIKASHI NAVIGATOR' })
    expect(logo).toHaveAttribute('src', '/brand/shikashi-logo-night.png')
    expect(logo).toHaveAttribute('width', '116')
    expect(logo).toHaveAttribute('height', '28')
    expect(screen.getByText('NAVIGATOR')).toHaveAttribute('aria-hidden', 'true')
  })

  it('BRAND-8: trip を渡すと昼のロゴ', () => {
    render(<BrandLogo theme="trip" height={24} />)
    expect(screen.getByRole('img', { name: 'SHIKASHI NAVIGATOR' })).toHaveAttribute(
      'src',
      '/brand/shikashi-logo.png',
    )
  })
})
