// api の URL と所有者トークンのヘッダ（docs/specs/stop-events/functional.md R9）。

/** 所有者トークンのヘッダ（`Authorization: Bearer <ownerToken>`。record の API と同じ渡し方） */
export function ownerAuthHeader(ownerToken: string): Record<string, string> {
  return { Authorization: `Bearer ${ownerToken}` }
}

export function apiBase(): string {
  const base = import.meta.env.VITE_API_BASE_URL as string | undefined
  return (base ?? '').replace(/\/+$/, '')
}

/** 失敗の応答の code（無ければ null） */
export function errorCode(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('error' in body)) return null
  const error = (body as { error: { code?: unknown } }).error
  return typeof error.code === 'string' ? error.code : null
}
