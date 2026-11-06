import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Lang } from '@antler/schema'

// OG 画像に同梱するフォント（docs/specs/og-font/functional.md）。Noto Sans JP / TC / KR の Bold（SIL OFL 1.1。CREDITS.md）。
// 取得は apps/api/scripts/fetch-og-fonts.mjs。システムのフォントには頼らない（Vercel の Linux には CJK のフォントが無い）。
// 置き場所は 2 通り（どちらかにあればよい）:
//   - ソースから動かすとき（tsx・vitest）: apps/api/assets/fonts/（このファイルから 4 つ上）
//   - bundle（dist/vercel/handler.mjs）: 同じ場所のフォント（vite.vercel.config.ts が publicDir で dist/vercel/ に写す）
// URL は 1 つずつ文字列のリテラルで書く（変数でパスを組まない）。Vercel のファイルの追跡（nft）が
// `new URL('…', import.meta.url)` の形を辿って、フォントを関数に入れる。

const FONTS = {
  'Noto Sans JP': [
    new URL('./NotoSansJP-Bold.otf', import.meta.url),
    new URL('../../../../assets/fonts/NotoSansJP-Bold.otf', import.meta.url),
  ],
  'Noto Sans TC': [
    new URL('./NotoSansTC-Bold.otf', import.meta.url),
    new URL('../../../../assets/fonts/NotoSansTC-Bold.otf', import.meta.url),
  ],
  'Noto Sans KR': [
    new URL('./NotoSansKR-Bold.otf', import.meta.url),
    new URL('../../../../assets/fonts/NotoSansKR-Bold.otf', import.meta.url),
  ],
} as const

/** SVG の font-family に書く名前（フォントの family 名。言語ごとに、その言語の字形が先） */
export const OG_FAMILIES: Record<Lang, readonly (keyof typeof FONTS)[]> = {
  ja: ['Noto Sans JP', 'Noto Sans TC', 'Noto Sans KR'],
  en: ['Noto Sans JP', 'Noto Sans TC', 'Noto Sans KR'],
  zh: ['Noto Sans TC', 'Noto Sans JP', 'Noto Sans KR'],
  ko: ['Noto Sans KR', 'Noto Sans JP', 'Noto Sans TC'],
}

/** 同梱のフォントのファイル（3 つ。resvg が文字ごとに足りるものを選ぶ）。1 つでも欠けていれば空（システムのフォントに任せる） */
export function bundledOgFontFiles(): string[] {
  const files: string[] = []
  for (const candidates of Object.values(FONTS)) {
    const found = candidates.map((u) => fileURLToPath(u)).find((f) => existsSync(f))
    if (!found) return []
    files.push(found)
  }
  return files
}
