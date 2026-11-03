import { useParams, useSearchParams } from 'react-router'

// URL の状態（functional.md R6・R7）: `/trip/:id/brief?day=n&alert=off`。
// day が無い・読めない → 1。alert は off のときだけ書く（初期値 ON。A6-4 は ON で戻る）。

export function parseDay(value: string | null): number {
  return value && /^[1-9][0-9]{0,2}$/.test(value) ? Number(value) : 1
}

export function useBriefParams() {
  const { id = '' } = useParams()
  const [search, setSearch] = useSearchParams()
  const day = parseDay(search.get('day'))
  const alertOn = search.get('alert') !== 'off'

  const setAlertOn = (on: boolean) => {
    setSearch(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (on) next.delete('alert')
        else next.set('alert', 'off')
        return next
      },
      { replace: true },
    )
  }

  return { id, day, alertOn, setAlertOn }
}

/** その日の A-2 へのリンク（アラートの状態を引き継ぐ） */
export function briefHref(id: string, day: number, alertOn: boolean): string {
  const q = new URLSearchParams({ day: String(day) })
  if (!alertOn) q.set('alert', 'off')
  return `/trip/${encodeURIComponent(id)}/brief?${q.toString()}`
}

/** 運転（drive-3d）へのリンク。OFF なら alert=off（drive の resolveAlertEnabled と同じ合図。R8） */
export function driveHref(id: string, day: number, alertOn: boolean): string {
  const q = new URLSearchParams({ trip: id, day: String(day) })
  if (!alertOn) q.set('alert', 'off')
  return `/drive?${q.toString()}`
}
