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

export function useChatTrack(scenario: DriveScenario, route: RouteInfo): ChatTrack {
  const { data } = useChatDeck(scenario)
  const legStartsM = useMemo(
    () => [0, ...scenario.legStarts.map((l) => l.sM)],
    [scenario.legStarts],
  )
  return useMemo(() => {
    const scene = {
      tripId: scenario.trip.id,
      day: scenario.day,
      data: scenario.data ? { routes: scenario.data.routes, zones: scenario.data.zones } : null,
      legCount: legStartsM.length,
    }
    const deck: ChatDeck =
      data && deckFits(data, scene)
        ? data
        : fallbackChatDeck({
            tripId: scenario.trip.id,
            day: scenario.day,
            legStartsM,
            totalM: route.totalM,
            zonesKm: route.zonesKm,
            partySize: scenario.trip.party.size,
            seed: scenario.seed,
          })
    return buildChatTrack(deck, {
      legStartsM,
      totalM: route.totalM,
      partySize: scenario.trip.party.size,
      seed: scenario.seed,
    })
  }, [data, scenario, legStartsM, route.totalM, route.zonesKm])
}
