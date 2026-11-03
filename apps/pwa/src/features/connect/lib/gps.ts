import type { Fix } from '@antler/zones'
import { logger } from '@/shared/utils/logger'

// スマホの GPS（watchPosition）を Fix に直す（pwa-drive R1）。
// 座標は画面・ログ・storage・ネットワークに出さない（ch5「精密な位置を保存しない」）。ログに残すのはエラーのコードだけ。

export type PositionLike = {
  coords: { latitude: number; longitude: number; accuracy: number; speed: number | null }
  timestamp: number
}
export type PositionErrorLike = { code: number }

export type GeoWatch = {
  watchPosition(
    ok: (p: PositionLike) => void,
    fail: (e: PositionErrorLike) => void,
    options: { enableHighAccuracy: boolean; maximumAge: number },
  ): number
  clearWatch(id: number): void
}

export const PERMISSION_DENIED = 1

/** 測位を Fix にする。緯度経度が数でなければ null（使わない）。speed が無い・NaN は undefined。 */
export function toFix(p: PositionLike, receivedAt: number): Fix | null {
  const { latitude, longitude, accuracy, speed } = p.coords
  if (![latitude, longitude, receivedAt].every(Number.isFinite)) return null
  return {
    lon: longitude,
    lat: latitude,
    accuracyM: Number.isFinite(accuracy) ? accuracy : undefined,
    // 端末の測位の時刻ではなく、受け取った時刻を使う（端末ごとの時計のずれで凍った緑・固定の琥珀にならないように）
    timestamp: receivedAt,
    speedMps: typeof speed === 'number' && Number.isFinite(speed) ? speed : undefined,
  }
}

/** 購読を始める。戻り値は解除。geolocation が無ければ何もしない。 */
export function watchFixes(
  geo: GeoWatch | undefined,
  onFix: (fix: Fix) => void,
  onDenied: () => void,
): () => void {
  if (!geo) return () => undefined
  let id: number | null = null
  try {
    id = geo.watchPosition(
      (p) => {
        const fix = toFix(p, Date.now())
        if (fix) onFix(fix)
      },
      (e) => {
        logger.warn('gps.error', { code: e.code })
        if (e.code === PERMISSION_DENIED) onDenied()
      },
      { enableHighAccuracy: true, maximumAge: 0 },
    )
  } catch {
    logger.warn('gps.error', { code: 'throw' })
  }
  return () => {
    if (id !== null) geo.clearWatch(id)
  }
}
