// record の URL（docs/specs/record/functional.md R1・R8・R9・R11）。

export function apiBase(): string {
  const base = import.meta.env.VITE_API_BASE_URL as string | undefined
  return (base ?? '').replace(/\/+$/, '')
}

/** sim の A-7（このアプリの中の画面） */
export function recordHref(tripId: string): string {
  return `/t/${encodeURIComponent(tripId)}`
}

/** 共有する記録の URL（api の SSR。OG の meta を出せるのはサーバーだけ） */
export function recordShareUrl(tripId: string): string {
  return `${apiBase()}/t/${encodeURIComponent(tripId)}`
}

/** しおりの PNG（OG 画像と同じもの） */
export function recordImageUrl(tripId: string): string {
  return `${recordShareUrl(tripId)}/og.png`
}

/** アラート OFF で挑戦（A7-4）: その日の A-2 へ alert=off で（brief-map R7 の合図） */
export function challengeOffHref(tripId: string, day: number): string {
  const q = new URLSearchParams({ day: String(day), alert: 'off' })
  return `/trip/${encodeURIComponent(tripId)}/brief?${q.toString()}`
}

/** B-0（PWA）。無ければ開発の既定 */
export function pwaUrl(): string {
  const url = import.meta.env.VITE_PWA_URL as string | undefined
  return url && url.length > 0 ? url : 'http://localhost:5174'
}

/** api の応答から code を取り出す */
export function errorCode(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('error' in body)) return null
  const code = (body as { error: { code?: unknown } }).error.code
  return typeof code === 'string' ? code : null
}
