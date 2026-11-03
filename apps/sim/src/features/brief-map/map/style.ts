// 地図の背景の提供元（functional.md R9、ch9 ① d）。OpenFreeMap の positron（OSM のベクタタイル、キー・費用なし）。
// `VITE_MAP_STYLE_URL=off` で背景を使わない（回線の無いデモ）。URL はビルド時の値だけで、旅の ID を載せない（threat.md AUTH-5）。

export const DEFAULT_MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'

/** 背景のスタイルの URL。使わないなら null */
export function mapStyleUrl(
  value: string | undefined = import.meta.env.VITE_MAP_STYLE_URL as string | undefined,
): string | null {
  const v = value?.trim()
  if (!v) return DEFAULT_MAP_STYLE_URL
  return v === 'off' ? null : v
}

/** WebGL2 が使えるか（jsdom・古い端末では背景なしにする） */
export function webglAvailable(): boolean {
  return typeof WebGL2RenderingContext !== 'undefined'
}
