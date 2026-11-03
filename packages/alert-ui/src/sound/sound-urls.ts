// 同梱の音源（自作の wav）の URL。Vite（A・B とも）がビルド時にファイルを出力して URL に置き換える。
// B の PWA はオフラインで鳴らすため、Service Worker でこの 2 つをキャッシュする（PWA の feature）。

export const SOUND_URLS = {
  chime: new URL('../../assets/sounds/chime.wav', import.meta.url).href,
  beep: new URL('../../assets/sounds/beep.wav', import.meta.url).href,
} as const
