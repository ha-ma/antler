import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { ownerTokenOf } from '@/features/plan-trip'
import type { DriveScenario } from '../types'
import { deckFits, fetchChatDeck, shouldRetryChat } from './chat-api'
import { buildChatTrack } from './chat-track'
import type { ChatDeck, ChatTrack } from './chat-types'
import { fallbackChatDeck } from './fallback-deck'

// その日の会話（docs/specs/drive-audio-chat/functional.md R18・R19）。
// - Server state: POST /api/trips/:id/day/:n/chat（TanStack Query。旅と日で決まるので staleTime: Infinity）
//   旅の場面でトークンがある端末だけが取りに行く。取れて、日・版・移動の数が合えば api の会話、そうでなければ見本の会話
// - 派生値: 道のりに写した ChatTrack（useMemo）。取れたら途中からでも替わる（advanceChat が差し替えを扱う）

export type RouteInfo = {
  /** ルート全体の長さ（m） */
  totalM: number
  /** 鹿ゾーンの区間（ルートの道のり km） */
  zonesKm: readonly (readonly [number, number])[]
}

export function useChatDeck(scenario: Pick<DriveScenario, 'source' | 'trip' | 'day'>) {
  const tripId = scenario.trip.id
  const ownerToken = scenario.source === 'trip' ? ownerTokenOf(tripId) : null
  return useQuery({
    queryKey: ['drive-chat', tripId, scenario.day],
    queryFn: ({ signal }) => fetchChatDeck(tripId, scenario.day, ownerToken ?? '', signal),
    enabled: ownerToken !== null && Number.isInteger(scenario.day) && scenario.day >= 1,
    staleTime: Infinity,
    retry: shouldRetryChat,
    retryDelay: 500,
  })
}

/**
 * 会話を道のりに写したもの。依存は値（文字列・数）だけにする。
 * 呼ぶ側が毎回新しい配列を渡しても作り直さない（約 10 Hz の track() で毎回作らない。component-guard W1）
 */
export function useChatTrack(scenario: DriveScenario, route: RouteInfo): ChatTrack {
  const { data } = useChatDeck(scenario)
  const tripId = scenario.trip.id
  const { day, seed } = scenario
  const partySize = scenario.trip.party.size
  const routes = scenario.data?.routes ?? null
  const zones = scenario.data?.zones ?? null
  const legKey = scenario.legStarts.map((l) => l.sM).join(',')
  const zonesKey = route.zonesKm.map(([a, b]) => `${String(a)}:${String(b)}`).join(',')
  const { totalM } = route
  return useMemo(() => {
    const legStartsM = [0, ...(legKey ? legKey.split(',').map(Number) : [])]
    const zonesKm = zonesKey
      ? zonesKey.split(',').map((z) => z.split(':').map(Number) as [number, number])
      : []
    const scene = {
      tripId,
      day,
      data: routes !== null && zones !== null ? { routes, zones } : null,
      legCount: legStartsM.length,
    }
    const deck: ChatDeck =
      data && deckFits(data, scene)
        ? data
        : fallbackChatDeck({ tripId, day, legStartsM, totalM, zonesKm, partySize, seed })
    return buildChatTrack(deck, { legStartsM, totalM, partySize, seed })
  }, [data, tripId, day, seed, partySize, routes, zones, legKey, zonesKey, totalM])
}
