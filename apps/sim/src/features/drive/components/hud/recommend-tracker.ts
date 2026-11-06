import type { DriveSnapshot } from '../../domain/engine'
import type { DriveScenario } from '../../types'
import {
  advanceRecommend,
  INITIAL_RECOMMEND,
  pickRecommendation,
  recommendFrameOf,
  rotationSlot,
  stopPositionsM,
  type Recommendation,
  type RecommendState,
} from './recommend'

// ## State設計（ゾーンの外のおすすめ。docs/specs/drive-tourism/functional.md T11・T12、drive-sound-tourism S16・S17）
// - Shared state（このクラス）: いま出すおすすめ（出さないなら null）と、実時間・ゾーンを出た後の間の記録。
//   入れ替え（12 秒ごと）も出すものの変化として知らせる。
//   運転のスナップショット（DriveEngine.subscribe、約 10 Hz）から進めるので、ChatFeedStore と同じく
//   subscribe / getSnapshot を持つ小さなクラスにした（React からは useSyncExternalStore で読む）。
//   出すものが変わったときだけ知らせる（10 Hz で描き直さない）
// - 派生値: 楽しみの道のり（作るときに 1 回）

type Source = {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => DriveSnapshot
}

export class RecommendTracker {
  private state: RecommendState = INITIAL_RECOMMEND
  private current: Recommendation | null = null
  private readonly stops: ReturnType<typeof stopPositionsM>
  private readonly listeners = new Set<() => void>()
  private unsubscribeSource: (() => void) | null = null

  constructor(
    private readonly source: Source,
    private readonly scenario: DriveScenario,
    totalM: number,
  ) {
    this.stops = stopPositionsM(scenario, totalM)
    this.update()
  }

  getSnapshot = (): Recommendation | null => this.current

  /**
   * 運転のスナップショットは 1 回だけ購読して、自分の購読者に配る（購読者が何人でも 1 フレーム 1 回だけ進める。
   * component-guard W3）。購読者がいなくなったら運転の購読もやめる
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    if (!this.unsubscribeSource) {
      this.update()
      this.unsubscribeSource = this.source.subscribe(() => {
        if (!this.update()) return
        for (const l of this.listeners) l()
      })
    }
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) {
        this.unsubscribeSource?.()
        this.unsubscribeSource = null
      }
    }
  }

  /** 進める。出すものが変わったら true（同じフレームを 2 回進めても同じ結果） */
  private update(): boolean {
    const snapshot = this.source.getSnapshot()
    const { state, visible } = advanceRecommend(this.state, recommendFrameOf(snapshot))
    this.state = state
    const next = visible
      ? pickRecommendation(
          this.scenario,
          this.stops,
          snapshot.zone.positionKm * 1000,
          rotationSlot(state.visibleMs),
        )
      : null
    const same =
      next?.pleasure.id === this.current?.pleasure.id &&
      next?.atDestination === this.current?.atDestination
    if (same) return false
    this.current = next
    return true
  }
}
