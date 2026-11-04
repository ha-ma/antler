import { resolveApiBaseUrl, resolveEdgeCaptureUrl } from './lib/capture-url'
import type { CaptureServices, CaptureTimeouts } from './types'

/** resilience.md「外部 API 設定」: edge の一覧 3 秒、edge の画像・同意・送信済み 5 秒、api 20 秒 */
export const DEFAULT_TIMEOUTS: CaptureTimeouts = { listMs: 3000, edgeMs: 5000, apiMs: 20000 }

/** ブラウザの実物。edge は WebSocket と同じホストの 8767、api は VITE_API_BASE_URL（無ければ undefined）。 */
export function createBrowserServices(): CaptureServices {
  const apiEnv: unknown = import.meta.env['VITE_API_BASE_URL']
  return {
    edgeBaseUrl: resolveEdgeCaptureUrl(globalThis.location.search, import.meta.env.DEV),
    apiBaseUrl: resolveApiBaseUrl(apiEnv),
    // 呼ぶたびに globalThis.fetch を引く（差し替えや後付けの polyfill を拾う）
    fetch: (url, init) => globalThis.fetch(url, init),
    sleep: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms)
      }),
    languages: globalThis.navigator.languages,
    timeouts: DEFAULT_TIMEOUTS,
  }
}
