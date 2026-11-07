import './brand-logo.css'

// SHIKASHI のロゴ（ユーザーが用意した透過 PNG、960×231）と製品の行（docs/specs/rebrand-shikashi R2）。
// 昼（trip）は濃い文字の版、夜（night）は明るい文字の版。名前は画像の alt で 1 回だけ読ませる。

const LOGO_SRC = {
  trip: '/brand/shikashi-logo.png',
  night: '/brand/shikashi-logo-night.png',
} as const

const LOGO_WIDTH = 960
const LOGO_HEIGHT = 231
const PRODUCT = 'SIMULATOR'

export const BRAND_NAME = `SHIKASHI ${PRODUCT}`

type Props = {
  theme: keyof typeof LOGO_SRC
  /** ロゴの高さ（px）。幅は元の比で決める */
  height?: number
  className?: string
}

export function BrandLogo({ theme, height = 24, className }: Props) {
  const width = Math.round((LOGO_WIDTH / LOGO_HEIGHT) * height)
  return (
    <span className={className ? `brand-logo ${className}` : 'brand-logo'}>
      <img
        className="brand-logo__image"
        src={LOGO_SRC[theme]}
        alt={BRAND_NAME}
        width={width}
        height={height}
        decoding="async"
      />
      <span className="brand-logo__product" aria-hidden="true">
        {PRODUCT}
      </span>
    </span>
  )
}
