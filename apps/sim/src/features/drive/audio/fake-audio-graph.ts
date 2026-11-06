import type { AudioGraphPort, MusicEvent } from './audio-graph'
import type { AudioLevels } from './mix'

// テスト用の音のグラフ（AudioGraphPort のフェイク）。呼ばれたことを記録するだけで音を出さない。
// 音・会話のテスト（audio/・chat/）が共有する。本番のコードからは import しない。

export class FakeAudioGraph implements AudioGraphPort {
  time = 0
  levels: AudioLevels[] = []
  /** setMusic に渡した URL（null は一時停止） */
  music: (string | null)[] = []
  notifies: { gain: number; tones: number }[] = []
  squeals: number[] = []
  crashes: number[] = []
  samplesBase: string | null = null
  state: 'running' | 'suspended' | 'closed' = 'suspended'
  /** 次の setMusic(url) で再生を拒ませる */
  blockNextPlay = false
  private listener: ((event: MusicEvent) => void) | null = null
  resumeCalls = 0
  suspendCalls = 0
  closeCalls = 0

  resume(): Promise<void> {
    this.resumeCalls += 1
    this.state = 'running'
    return Promise.resolve()
  }
  suspend(): Promise<void> {
    this.suspendCalls += 1
    this.state = 'suspended'
    return Promise.resolve()
  }
  close(): void {
    this.closeCalls += 1
    this.state = 'closed'
  }
  currentTime(): number {
    return this.time
  }
  setLevels(levels: AudioLevels): void {
    this.levels.push(levels)
  }
  setMusic(url: string | null): void {
    // 同じ値が続くときは 1 回として記録する（約 10 Hz で同じ値が来る）
    if (this.music.at(-1) !== url) this.music.push(url)
    if (url !== null && this.blockNextPlay) {
      this.blockNextPlay = false
      this.music.push(null)
      this.listener?.('blocked')
    }
  }
  onMusicEvent(listener: (event: MusicEvent) => void): void {
    this.listener = listener
  }
  /** 曲の出来事をテストから起こす */
  emitMusic(event: MusicEvent): void {
    this.listener?.(event)
  }
  loadSamples(base: string): void {
    this.samplesBase = base
  }
  playSqueal(gain: number): void {
    this.squeals.push(gain)
  }
  playCrash(gain: number): void {
    this.crashes.push(gain)
  }
  playNotify(gain: number, tones: number): void {
    this.notifies.push({ gain, tones })
  }
  /** いま流している曲（最後の setMusic） */
  playing(): string | null {
    return this.music.at(-1) ?? null
  }
}
