import type { Lang } from '@antler/schema'
import { MAX_PLEASURES, PERSONA_INPUT, initialLang, type Area } from '@antler/trip'
import { create } from 'zustand'
import type { PleasureSelection, SelectionsByArea } from './types'

// ## State設計（plan-trip / A-1 旅をつくる）
// - Server state: `POST /api/trips` の作成（TanStack Query の useMutation。hooks/useCreateTrip.ts）。
//   読み出しの API はまだ無い（GET は brief-map の feature）。
// - Shared state（この store）: エリアごとの楽しみの選択（selections。重さは持たない）、表示中のエリア（area）、
//   画面の言語（lang）。PleasureCard・エリアタブ・しおりパネル・言語切替・フォームが共有する。
// - Local UI state: なし（失敗の表示は mutation の状態から作る）。
// - Form state: 人数・運転できる人・経験・出発と返却の日時と場所・予算（React Hook Form。
//   日時は datetime-local の文字列で持ち、+09:00 を付けて TripInput にする）。
// - URL state: `/plan`、作成後の `/trip/:id/brief`（id は URL、タイトルは遷移の state）。
// - 派生値: TripInput・しおり・リスク・タイトル・予算の表示は useMemo で毎回作る（hooks/useTripPreview.ts）。
// - useEffect: 使わない。冪等キーは sessionStorage に「押したとき」に書く（イベントハンドラ）。

type PlanTripState = {
  selections: SelectionsByArea
  area: Area
  lang: Lang
}

type PlanTripActions = {
  togglePleasure: (id: string) => void
  setArea: (area: Area) => void
  setLang: (lang: Lang) => void
  resetPlanTrip: (languages?: readonly string[]) => void
}

function browserLanguages(): readonly string[] {
  return typeof navigator === 'undefined' ? [] : navigator.languages
}

/** 初期値はペルソナ（付録 A #4）。言語だけはブラウザの言語から決める（R6）。 */
export function initialPlanTripState(languages: readonly string[]): PlanTripState {
  const selections: SelectionsByArea = { doto: [], doo: [] }
  selections[PERSONA_INPUT.area] = PERSONA_INPUT.pleasures.map((p) => ({ id: p.id }))
  return { selections, area: PERSONA_INPUT.area, lang: initialLang(languages) }
}

function updateArea(
  state: PlanTripState,
  update: (current: PleasureSelection[]) => PleasureSelection[],
): Pick<PlanTripState, 'selections'> {
  return { selections: { ...state.selections, [state.area]: update(state.selections[state.area]) } }
}

export const usePlanTripStore = create<PlanTripState & PlanTripActions>()((set) => ({
  ...initialPlanTripState(browserLanguages()),
  togglePleasure: (id) =>
    set((state) =>
      updateArea(state, (current) => {
        if (current.some((p) => p.id === id)) return current.filter((p) => p.id !== id)
        if (current.length >= MAX_PLEASURES) return current
        return [...current, { id }]
      }),
    ),
  setArea: (area) => set({ area }),
  setLang: (lang) => set({ lang }),
  resetPlanTrip: (languages = browserLanguages()) => set(initialPlanTripState(languages)),
}))

/** 表示中のエリアの選択。 */
export function useAreaSelections(): PleasureSelection[] {
  return usePlanTripStore((s) => s.selections[s.area])
}
