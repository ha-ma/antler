import { MAX_PLEASURES, PERSONA_INPUT, pleasuresInArea } from '@antler/trip'
import { DEFAULT_WEIGHT, initialPlanTripState, usePlanTripStore } from './store'

describe('plan-trip store', () => {
  beforeEach(() => usePlanTripStore.getState().resetPlanTrip(['ja-JP']))

  it('UC-6a ブラウザの言語から初期言語を決める（zh-TW → zh、fr → ja、ko → ko）', () => {
    expect(initialPlanTripState(['zh-TW', 'en']).lang).toBe('zh')
    expect(initialPlanTripState(['fr-FR']).lang).toBe('ja')
    expect(initialPlanTripState(['ko-KR']).lang).toBe('ko')
  })

  it('初期値はペルソナの選択（道東・流氷 5・タンチョウ 4）', () => {
    const state = usePlanTripStore.getState()
    expect(state.area).toBe(PERSONA_INPUT.area)
    expect(state.selections.doto).toEqual(PERSONA_INPUT.pleasures)
    expect(state.selections.doo).toEqual([])
  })

  it('UC-2b 10 件選択済みで 11 件目は増えない。外すと重さも消える', () => {
    const { togglePleasure, setWeight } = usePlanTripStore.getState()
    for (const p of pleasuresInArea('doto')) togglePleasure(p.id)
    // ペルソナの 2 件は外れ、残りが選ばれる。上限まで足す
    const doto = () => usePlanTripStore.getState().selections.doto
    for (const p of pleasuresInArea('doto')) {
      if (!doto().some((s) => s.id === p.id)) togglePleasure(p.id)
    }
    expect(doto()).toHaveLength(MAX_PLEASURES)

    const first = doto()[0]
    if (!first) throw new Error('選択が無い')
    setWeight(first.id, 5)
    togglePleasure(first.id)
    expect(doto().some((s) => s.id === first.id)).toBe(false)
    togglePleasure(first.id)
    expect(doto().find((s) => s.id === first.id)?.weight).toBe(DEFAULT_WEIGHT)
  })

  it('UC-2c 選択はエリアごとに保持する', () => {
    const { setArea, togglePleasure } = usePlanTripStore.getState()
    setArea('doo')
    const doo = pleasuresInArea('doo')[0]
    if (!doo) throw new Error('道央のマスターが空')
    togglePleasure(doo.id)
    expect(usePlanTripStore.getState().selections.doo).toHaveLength(1)
    expect(usePlanTripStore.getState().selections.doto).toEqual(PERSONA_INPUT.pleasures)
  })
})
