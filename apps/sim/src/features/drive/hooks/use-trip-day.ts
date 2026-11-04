import { useQuery } from '@tanstack/react-query'
import { fetchTripDay, shouldRetryTripDay } from '../api/trip-day'

/** その日の行程（drive-link R2）。同じ旅・同じ日は同じ結果（シードで再現できる）なので読み直さない */
export function useTripDay(id: string, day: number) {
  return useQuery({
    // brief-map の ['trip-day', …] とは中身の形が違う（details を持たない）ので、別の鍵にする
    queryKey: ['drive-trip-day', id, day],
    queryFn: ({ signal }) => fetchTripDay(id, day, signal),
    staleTime: Infinity,
    retry: shouldRetryTripDay,
    retryDelay: 500,
  })
}
