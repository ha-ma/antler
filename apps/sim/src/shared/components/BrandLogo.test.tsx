import { render, screen } from '@testing-library/react'
import { BRAND_NAME, BrandLogo } from './BrandLogo'

describe('BrandLogo（docs/specs/rebrand-shikashi R2）', () => {
  it('BRAND-1: trip は昼のロゴ、night は夜のロゴ。幅と高さを持ち、名前は alt で 1 回だけ', () => {
    const { rerender } = render(<BrandLogo theme="trip" />)
    const day = screen.getByRole('img', { name: 'SHIKASHI SIMULATOR' })
    expect(day).toHaveAttribute('src', '/brand/shikashi-logo.png')
    expect(day).toHaveAttribute('height', '24')
    expect(day).toHaveAttribute('width', '100')
    expect(screen.getByText('SIMULATOR')).toHaveAttribute('aria-hidden', 'true')

    rerender(<BrandLogo theme="night" height={28} />)
    const night = screen.getByRole('img', { name: BRAND_NAME })
    expect(night).toHaveAttribute('src', '/brand/shikashi-logo-night.png')
    expect(night).toHaveAttribute('height', '28')
    expect(night).toHaveAttribute('width', '116')
  })
})
