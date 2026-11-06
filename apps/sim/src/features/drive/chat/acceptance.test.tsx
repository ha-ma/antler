import { act, render, screen } from '@testing-library/react'
import type { AudioGraphPort, ScheduledNote } from '../audio/audio-graph'
import { AudioSettingsStore } from '../audio/audio-settings'
import { DriveAudio } from '../audio/drive-audio'
import { DEFAULT_AUDIO_SETTINGS, mixLevels, type AudioLevels } from '../audio/mix'
import { signalsFromSnapshot } from '../audio/signals'
import type { DriveSnapshot } from '../domain/engine'
import { NO_INPUT, type DriveInput, type Encounter } from '../types'
import { ChatFeedStore } from './chat-feed-store'
import { REACTION_TEXT } from './chat-text'
import { buildChatTrack } from './chat-track'
import type { ChatDeck } from './chat-types'
import { ChatFeed } from './ChatFeed'
import { linkDriveSoundAndChat, type DriveSource } from './link-drive'

// 受け入れ（AC-42）: 会話の束と運転のスナップショットの列を部品（音・会話・表示）に通す。
// 運転画面への組み込みは PR 2（drive-tune の後）。ここでは DriveEngine の代わりにスナップショットを手で流す。

class FakeGraph implements AudioGraphPort {
  time = 0
  levels: AudioLevels[] = []
  notifies = 0
  resume = () => Promise.resolve()
  suspend = () => Promise.resolve()
  close = () => undefined
  currentTime = () => this.time
  setLevels = (l: AudioLevels) => {
    this.levels.push(l)
  }
  scheduleNotes = (_n: readonly ScheduledNote[]) => undefined
  playNotify = () => {
    this.notifies += 1
  }
}

const L = (ja: string) => ({ ja, en: ja, zh: ja, ko: ja })
const DECK: ChatDeck = {
  tripId: 'K7m2',
  day: 1,
  lines: [
    {
      id: 'l01',
      cue: { kind: 'road', leg: 0, km: 0.2 },
      topic: 'depart',
      speaker: 'p1',
      text: L('出発だね'),
    },
    {
      id: 'l02',
      cue: { kind: 'road', leg: 0, km: 16 },
      topic: 'weather',
      speaker: 'p2',
      text: L('雪だ'),
    },
    {
      id: 'l03',
      cue: { kind: 'road', leg: 0, km: 17 },
      topic: 'snack',
      speaker: 'p3',
      text: L('おやつ'),
    },
    {
      id: 'l04',
      cue: { kind: 'road', leg: 0, km: 18 },
      topic: 'music',
      speaker: 'p1',
      text: L('いい曲'),
    },
  ],
  data: { routes: 'r', zones: 'z' },
}

function snapshot(over: Partial<DriveSnapshot> & { km: number; inZone?: boolean }): DriveSnapshot {
  const { km, inZone = false, ...rest } = over
  return {
    t: 0,
    clockMs: 0,
    sunsetMs: null,
    speedKmh: 60,
    playback: { rate: 1, paused: false, locked: false },
    zone: {
      gps: inZone ? { status: 'inside', remainingKm: 1 } : { status: 'outside', distanceKm: 1 },
      interval: inZone ? 0 : null,
      nextEntryKm: null,
      positionKm: km,
    },
    nextZoneEtaMs: null,
    alert: { state: inZone ? 'zone' : 'safe', distance: 1, inZone },
    light: 'dusk',
    outcome: 'driving',
    alertEnabled: true,
    lang: 'ja',
    weather: 'snow',
    surface: 'packed-snow',
    encounters: [],
    ...rest,
  } as DriveSnapshot
}

class FakeEngine implements DriveSource {
  private current: DriveSnapshot = snapshot({ km: 0, speedKmh: 0 })
  private readonly listeners = new Set<() => void>()
  world: { input: DriveInput } = { input: { ...NO_INPUT } }
  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  getSnapshot = () => this.current
  publish(next: DriveSnapshot) {
    this.current = next
    for (const l of this.listeners) l()
  }
}

describe('AC-42: 運転の音と車内の会話（部品の通し）', () => {
  it('会話が順に出て、通知音は緑のときだけ鳴り、赤で BGM が 0・エンジンが半分になる', async () => {
    const graph = new FakeGraph()
    let nowMs = 0
    const audio = new DriveAudio({
      createGraph: () => graph,
      settings: new AudioSettingsStore(null),
      seed: 1,
      nowMs: () => nowMs,
    })
    await audio.start()
    const feed = new ChatFeedStore()
    const track = buildChatTrack(DECK, { legStartsM: [0], totalM: 40_000, partySize: 4, seed: 1 })
    const engine = new FakeEngine()
    render(<ChatFeed feed={feed} lang="ja" dimmed={false} />)
    const unlink = linkDriveSoundAndChat(engine, audio, feed, () => track)
    const step = (s: DriveSnapshot, advanceMs = 3000) => {
      nowMs += advanceMs
      graph.time += advanceMs / 1000
      act(() => engine.publish(s))
    }

    // 出発 → depart（通知音 1 回）
    engine.world.input = { ...NO_INPUT, throttle: true }
    step(snapshot({ t: 1000, km: 0.3 }))
    expect(screen.getByText('出発だね')).toBeInTheDocument()
    expect(graph.notifies).toBe(1)
    const cruising = graph.levels.at(-1)
    expect(cruising?.engine).toBeGreaterThan(0)
    expect(cruising?.music).toBeGreaterThan(0)

    // 16× で 3 行を一度に越える → 3 行が順に出て、通知音は 1 回
    step(snapshot({ t: 60_000, km: 18.5, playback: { rate: 16, paused: false, locked: false } }))
    const texts = [...document.querySelectorAll('.drive-chat__text')].map((n) => n.textContent)
    expect(texts).toEqual(['出発だね', '雪だ', 'おやつ', 'いい曲'])
    expect(graph.notifies).toBe(2)

    // ゾーンに入る → 2.5 秒後に zone-enter が出るが、琥珀なので通知音は鳴らない
    step(snapshot({ t: 61_000, km: 19, inZone: true }))
    step(snapshot({ t: 63_600, km: 19.05, inZone: true }))
    expect(screen.getByText(REACTION_TEXT['zone-enter'][0].ja)).toBeInTheDocument()
    expect(graph.notifies).toBe(2)
    expect(graph.levels.at(-1)?.music).toBeCloseTo((cruising?.music ?? 0) * 0.6)

    // 赤 → BGM 0、エンジン半分。避けた行は待たされる
    const avoided: Encounter = {
      deerId: 'd1',
      pattern: 'crossing',
      alertAt: 64_000,
      alertClockAt: null,
      brakeAt: 64_500,
      alertToBrakeMs: 500,
      closestM: 12,
      outcome: 'avoided',
    }
    engine.world.input = { ...NO_INPUT, brake: true }
    const dangerSnapshot = snapshot({
      t: 64_000,
      km: 19.1,
      inZone: true,
      alert: { state: 'danger', distance: 30, inZone: true },
    })
    step(dangerSnapshot)
    const danger = graph.levels.at(-1)
    // 同じ合図の琥珀と比べて、エンジンとブレーキは半分、BGM は 0
    const same = mixLevels(
      { ...signalsFromSnapshot(dangerSnapshot, engine.world.input), alert: 'zone' },
      DEFAULT_AUDIO_SETTINGS,
    )
    expect(danger?.music).toBe(0)
    expect(danger?.engine).toBeCloseTo(same.engine / 2)
    expect(danger?.brakeNoise).toBeCloseTo(same.brakeNoise / 2)
    expect(danger?.brakeNoise).toBeGreaterThan(0)

    // 避けた（赤が終わってから遭遇が avoided になる）→ 赤の後 1.5 秒は待たされ、その後に出る。
    // 琥珀の中なので通知音は鳴らない
    engine.world.input = { ...NO_INPUT }
    step(snapshot({ t: 66_000, km: 19.12, inZone: true, encounters: [avoided] }))
    expect(screen.queryByText(REACTION_TEXT.avoided[0].ja)).not.toBeInTheDocument()
    step(snapshot({ t: 67_600, km: 19.2, inZone: true, encounters: [avoided] }))
    expect(screen.getByText(REACTION_TEXT.avoided[0].ja)).toBeInTheDocument()
    expect(graph.notifies).toBe(2)

    // 見えるのは新しい 4 行まで
    expect(document.querySelectorAll('.drive-chat__line')).toHaveLength(4)

    // 「もう一度」（t が戻る）→ 表示が消え、最初の行がまた出る
    step(snapshot({ t: 0, km: 0, speedKmh: 0 }))
    expect(document.querySelectorAll('.drive-chat__line')).toHaveLength(0)
    step(snapshot({ t: 1000, km: 0.3 }))
    expect(screen.getByText('出発だね')).toBeInTheDocument()
    unlink()
    audio.dispose()
  })
})
