import { useSearchParams } from 'react-router'
import { TRIP_ID } from '../api/trip-day'

// /drive の URL（drive-link R1）: `?trip={id}&day={n}(&alert=off)`。trip が無ければ見本の場面。

/** day が無い・読めない → 1（brief-map の parseDay と同じ規則: 1〜999 の整数） */
export function parseDay(value: string | null): number {
  return value && /^[1-9][0-9]{0,2}$/.test(value) ? Number(value) : 1
}

export type DriveParams =
  | { kind: 'demo'; search: string }
  | { kind: 'bad-trip'; search: string }
  | { kind: 'trip'; id: string; day: number; alertOn: boolean; search: string }

export function readDriveParams(search: URLSearchParams): DriveParams {
  const text = search.toString() === '' ? '' : `?${search.toString()}`
  const id = search.get('trip')
  if (id === null) return { kind: 'demo', search: text }
  if (!TRIP_ID.test(id)) return { kind: 'bad-trip', search: text }
  return {
    kind: 'trip',
    id,
    day: parseDay(search.get('day')),
    alertOn: search.get('alert') !== 'off',
    search: text,
  }
}

export function useDriveParams(): DriveParams {
  const [search] = useSearchParams()
  return readDriveParams(search)
}

/** その日の A-2 へのリンク（アラートの状態を引き継ぐ。brief-map の briefHref と同じ形） */
export function briefHref(id: string, day: number, alertOn: boolean): string {
  const q = new URLSearchParams({ day: String(day) })
  if (!alertOn) q.set('alert', 'off')
  return `/trip/${encodeURIComponent(id)}/brief?${q.toString()}`
}
