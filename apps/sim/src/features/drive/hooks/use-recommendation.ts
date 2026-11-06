import { useState, useSyncExternalStore } from 'react'
import { RecommendTracker } from '../components/hud/recommend-tracker'
import type { Recommendation } from '../components/hud/recommend'
import type { DriveEngine } from '../domain/engine'

/**
 * いま出すゾーンの前のおすすめ（docs/specs/drive-tourism/functional.md T11・T12）。出さないときは null。
 * 運転のスナップショット（約 10 Hz）から進め、出すものが変わったときだけ描き直す（State設計は RecommendTracker）
 */
export function useRecommendation(engine: DriveEngine): Recommendation | null {
  const [tracker] = useState(
    () => new RecommendTracker(engine, engine.world.scenario, engine.world.plan.totalKm * 1000),
  )
  return useSyncExternalStore(tracker.subscribe, tracker.getSnapshot)
}
