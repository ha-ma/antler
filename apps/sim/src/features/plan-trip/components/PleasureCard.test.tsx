import { pleasureById, type Pleasure } from '@antler/trip'
import { render, screen, within } from '@testing-library/react'
import { usePlanTripStore } from '../store'
import { photoOf } from '../utils/photos'
import { PleasureCard } from './PleasureCard'

// plan-trip-photos R7: カードの写真と引用。

describe('PleasureCard の写真と引用', () => {
  beforeEach(() => usePlanTripStore.getState().resetPlanTrip(['ja-JP']))

  it('PH-4: 写真のあるカードは画像（alt=""）と「写真: 撮影者 / ライセンス」を出し、新しいタブでリンクする。引用はボタンの外', () => {
    const pleasure = pleasureById('drift-ice-walk')
    const photo = photoOf('drift-ice-walk')
    if (!pleasure || !photo) throw new Error('流氷ウォークの写真の記録が無い')
    const { container } = render(
      <PleasureCard pleasure={pleasure} selected={false} locked={false} />,
    )

    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img).toHaveAttribute('alt', '')
    expect(img?.getAttribute('src')).toBe(`/${photo.file}`)

    const toggle = screen.getByRole('button', { name: /流氷ウォーク/ })
    // ボタンの名前は楽しみの名前だけ（撮影者・ライセンスを含まない）
    expect(toggle).toHaveAccessibleName('流氷ウォーク')
    expect(within(toggle).queryByRole('link')).toBeNull()

    const source = screen.getByRole('link', {
      name: new RegExp(`流氷ウォーク の写真.*${photo.author}`),
    })
    expect(source).toHaveAttribute('href', photo.sourceUrl)
    expect(source).toHaveAttribute('target', '_blank')
    expect(source).toHaveAttribute('rel', 'noopener noreferrer')
    expect(source).toHaveTextContent(photo.author)
    expect(source.getAttribute('aria-label')).toContain('新しいタブ')

    const license = screen.getByRole('link', { name: /ライセンス/ })
    expect(license).toHaveAttribute('href', photo.licenseUrl)
    expect(license).toHaveTextContent(photo.license)
    expect(license).toHaveAttribute('rel', 'noopener noreferrer')
    expect(source.closest('p')?.textContent).toContain(`写真: ${photo.author} / ${photo.license}`)
  })

  it('PH-5: 写真の記録が無いカードは placeholder の文言を出し、引用を出さない', () => {
    const base = pleasureById('drift-ice-walk')
    if (!base) throw new Error('マスターが空')
    const noPhoto: Pleasure = { ...base, id: 'no-photo-pleasure' }
    const { container } = render(
      <PleasureCard pleasure={noPhoto} selected={false} locked={false} />,
    )
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('写真：流氷ウォーク')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
