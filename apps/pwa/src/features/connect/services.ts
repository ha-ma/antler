import { AlertSoundController, SOUND_URLS, WebAudioPort } from '@antler/alert-ui'
import { logger } from '@/shared/utils/logger'
import type { SocketLike } from './lib/edge-client'
import { resolveEdgeUrl } from './lib/edge-url'
import { alertSoundEnabled, SilentAudioPort } from './lib/silent-audio'
import { browserLocationDeps } from './lib/location'
import { loadBundledZones } from './lib/zones-loader'
import { browserWakeLockDeps } from './lib/wake-lock'
import type { ConnectServices } from './types'

/**
 * ブラウザの実物。接続先は本番ではページのホスト（VITE_EDGE_HOSTS にあるとき）か一覧の先頭、
 * https のページなら wss。開発ビルドだけ ?edge= で変えられる（docs/specs/pwa-https R5）。
 */
export function createBrowserServices(): ConnectServices {
  const soundOn = alertSoundEnabled(import.meta.env)
  const edgeHosts: unknown = import.meta.env['VITE_EDGE_HOSTS']
  const port = soundOn ? new WebAudioPort(SOUND_URLS) : new SilentAudioPort()
  const sound = new AlertSoundController(port, {
    onError: (event, error) => {
      logger.error(event, error)
    },
  })
  return {
    url: resolveEdgeUrl(globalThis.location, import.meta.env.DEV, edgeHosts),
    // ブラウザの WebSocket は SocketLike の上位互換（ハンドラの引数を使わないだけ）
    createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
    location: browserLocationDeps(),
    geo: globalThis.navigator.geolocation as unknown as ConnectServices['geo'],
    loadZones: () => loadBundledZones(),
    wakeLock: browserWakeLockDeps(),
    sound,
    playTestSound: () => {
      port.playChime()
    },
    primeSpeech: () => {
      if (!soundOn) return
      try {
        globalThis.speechSynthesis?.speak(new SpeechSynthesisUtterance(''))
      } catch {
        // 読み上げが使えない端末では、赤のときの読み上げだけ無くなる（sound.failed 側で記録される）
      }
    },
    languages: globalThis.navigator.languages,
  }
}
