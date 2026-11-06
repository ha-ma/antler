import type { EmittedLine } from './advance-chat'
import type { FeedLine } from './chat-types'

// ## State設計（車内の会話の表示。docs/specs/drive-audio-chat/functional.md R13）
// - Shared state（この store）: 画面に出ている会話（新しい 3 行まで。写真で 1 行が高いので。drive-tourism T8）と、読み上げる最後の行。
//   走行ごとに作り、運転のスナップショット（DriveEngine.subscribe）から足すので、モジュールに 1 つの Zustand の store ではなく
//   DriveEngine と同じく subscribe / getSnapshot を持つ小さなクラスにした（React からは useSyncExternalStore で読む）。
// - 派生値・Server state: なし（会話の束は useChatTrack）。

export const VISIBLE_LINES = 3

export type FeedSnapshot = {
  lines: readonly FeedLine[]
  /** 見えない aria-live に入れる、いちばん新しい行 */
  latest: FeedLine | null
}

const EMPTY: FeedSnapshot = { lines: [], latest: null }

export class ChatFeedStore {
  private snapshot: FeedSnapshot = EMPTY
  private readonly listeners = new Set<() => void>()

  getSnapshot = (): FeedSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  push(lines: readonly EmittedLine[]): void {
    if (lines.length === 0) return
    const next = [...this.snapshot.lines, ...lines].slice(-VISIBLE_LINES)
    this.set({ lines: next, latest: lines.at(-1) ?? null })
  }

  reset(): void {
    if (this.snapshot === EMPTY) return
    this.set(EMPTY)
  }

  private set(next: FeedSnapshot): void {
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}
