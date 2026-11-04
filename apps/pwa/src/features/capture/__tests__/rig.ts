import { vi } from 'vitest'
import type { CaptureServices } from '../types'
import { API_BASE, createBackend, EDGE_BASE, type BackendOptions } from './fake-edge'

/** 偽の edge + api と、それにつないだ CaptureServices。sleep は待たずに戻る。 */
export function rig(options: BackendOptions = {}, over: Partial<CaptureServices> = {}) {
  const backend = createBackend(options)
  const sleep = vi.fn((_ms: number) => Promise.resolve())
  const services: CaptureServices = {
    edgeBaseUrl: EDGE_BASE,
    apiBaseUrl: API_BASE,
    fetch: backend.fetch,
    sleep,
    languages: ['ja-JP'],
    timeouts: { listMs: 1000, edgeMs: 1000, apiMs: 1000 },
    ...over,
  }
  return { backend, services, sleep }
}
