import type { FetchLike } from './lib/upload'

/** 打ち切り（resilience.md「外部 API 設定」）。テストでは小さい値を差し込む。 */
export type CaptureTimeouts = {
  /** edge の一覧 */
  listMs: number
  /** edge の画像・同意・送信済み */
  edgeMs: number
  /** api への POST */
  apiMs: number
}

/** CaptureGate が使う外部の仕組み。ブラウザの実物は services.ts、テストでは偽物を差し込む。 */
export type CaptureServices = {
  /** edge の Capture サーバー（例: http://ezoroad.local:8767） */
  edgeBaseUrl: string
  /** VITE_API_BASE_URL。無ければ送り先が無いので画面を出さない */
  apiBaseUrl: string | undefined
  fetch: FetchLike
  /** 429 の待ち。テストでは待たずに戻る */
  sleep: (ms: number) => Promise<void>
  languages: readonly string[]
  timeouts: CaptureTimeouts
}
