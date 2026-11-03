import { useQuery } from '@tanstack/react-query'
import type { ZoneCollection } from '@antler/zones'

/** 同梱の鹿ゾーン DB。読み込み・照合・形のどれかが失敗したら使わない（failed）。 */
export function useZones(load: () => Promise<ZoneCollection>): {
  zones: ZoneCollection | null
  failed: boolean
} {
  const query = useQuery({ queryKey: ['zones'], queryFn: load, staleTime: Infinity })
  return { zones: query.data ?? null, failed: query.isError }
}
