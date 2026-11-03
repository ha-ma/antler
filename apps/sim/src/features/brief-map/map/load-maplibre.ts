// MapLibre GL JS の遅延読込（functional.md R9。A-2 の初回読込に入れない）。
// ワーカーはバンドルに含めた同じ origin のファイルを使う（CSP の worker-src 'self'。blob のワーカーを作らない）。

export type MapLibre = typeof import('maplibre-gl')

export async function loadMapLibre(): Promise<MapLibre> {
  const [maplibre, worker] = await Promise.all([
    import('maplibre-gl'),
    import('maplibre-gl/dist/maplibre-gl-worker.mjs?url'),
    import('maplibre-gl/dist/maplibre-gl.css'),
  ])
  maplibre.setWorkerUrl(worker.default)
  return maplibre
}
