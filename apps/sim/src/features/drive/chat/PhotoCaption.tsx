import type { Lang } from '@antler/schema'
import type { PleasurePhoto } from '@/features/plan-trip'
import { PHOTO_LABEL } from './chat-text'

/**
 * 写真の出典（drive-tourism T8・T13）。「写真: 撮影者 / ライセンス」を平文で出す。
 * HUD の中なのでリンクにしない（操作要素を置かない・ポインタを通す）。リンクは A-1 の楽しみのカードと CREDITS.md にある。
 * 撮影者とライセンス名は訳さない
 */
export function PhotoCaption({
  photo,
  lang,
  className,
}: {
  photo: PleasurePhoto
  lang: Lang
  className: string
}) {
  return (
    <span className={className}>
      {PHOTO_LABEL[lang]}: {photo.author} / {photo.license}
    </span>
  )
}
