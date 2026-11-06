import { act, render, screen } from '@testing-library/react'
import { AudioSettingsStore } from '../audio/audio-settings'
import { DriveAudio } from '../audio/drive-audio'
import { FakeAudioGraph } from '../audio/fake-audio-graph'
import { DEFAULT_AUDIO_SETTINGS, mixLevels } from '../audio/mix'
import { firstTrackIndex, MUSIC_TRACKS } from '../audio/music-tracks'
import { driveAudioSignals } from '../audio/signals'
import { RecommendTracker } from '../components/hud/recommend-tracker'
import {
  DriveEngine,
  type CueListener,
  type DriveSnapshot,
  type DriveTelemetry,
} from '../domain/engine'
import { demoScenario } from '../domain/scenario'
import { ZONES } from '../domain/zones-data'
import type { Encounter } from '../types'
import { ChatFeedStore } from './chat-feed-store'
import { REACTION_TEXT } from './chat-text'
import { buildChatTrack } from './chat-track'
import type { ChatDeck } from './chat-types'
import { ChatFeed } from './ChatFeed'
import { fallbackChatDeck } from './fallback-deck'
import { linkDriveSoundAndChat, type DriveSource } from './link-drive'
import { tourismStops } from './tourism'

// 受け入れ（AC-42）: 会話の束と運転のスナップショットの列を部品（音・会話・表示）に通す。
// 運転画面への組み込みは PR 2（drive-tune の後）。ここでは DriveEngine の代わりにスナップショットを手で流す。

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
      pleasure: null,
      text: L('出発だね'),
    },
    {
      // 楽しみの話の行（drive-tourism T8）: 写真と出典が添えられる
      id: 'l02',
      cue: { kind: 'road', leg: 0, km: 16 },
      topic: 'pleasure',
      speaker: 'p2',
      pleasure: 'red-crowned-crane',
      text: L('雪だ'),
    },
    {
      id: 'l03',
      cue: { kind: 'road', leg: 0, km: 17 },
      topic: 'snack',
      speaker: 'p3',
      pleasure: null,
      text: L('おやつ'),
    },
    {
      id: 'l04',
      cue: { kind: 'road', leg: 0, km: 18 },
      topic: 'music',
      speaker: 'p1',
      pleasure: null,
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
    stage: { index: 1, count: 1 },
    stageClearedAt: null,
    destination: { km: 40, etaMs: 0 },
    ...rest,
  }
}

const TELEMETRY: DriveTelemetry = {
  rpm: 1800,
  gear: 4,
  throttle: false,
  brake: 0,
  speedKmh: 60,
  abs: false,
}

class FakeEngine implements DriveSource {
  private current: DriveSnapshot = snapshot({ km: 0, speedKmh: 0 })
  private readonly listeners = new Set<() => void>()
  /** drive-tune の DriveEngine.telemetry() の代わり */
  tele: DriveTelemetry = { ...TELEMETRY }
  telemetry = () => this.tele
  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  getSnapshot = () => this.current
  private readonly cues = new Set<CueListener>()
  onCue = (l: CueListener) => {
    this.cues.add(l)
    return () => this.cues.delete(l)
  }
  publish(next: DriveSnapshot) {
    this.current = next
    for (const l of this.listeners) l()
  }
  cue(events: Parameters<CueListener>[0]) {
    for (const l of this.cues) l(events)
  }
}

describe('AC-42・AC-1・SND-3b: 運転の音と車内の会話（部品の通し）', () => {
  it('会話が順に出て、通知音は緑で 2 音・琥珀で 1 音、赤で BGM が 0・エンジンが半分、ブレーキで鳴き、衝突で衝撃音', async () => {
    const graph = new FakeAudioGraph()
    let nowMs = 0
    const audio = new DriveAudio({
      createGraph: () => graph,
      settings: new AudioSettingsStore(null),
      seed: 1,
      nowMs: () => nowMs,
    })
    await audio.start()
    // AC-1: 「出発」でシードの曲を流す（短い音は読み込みを始める）
    expect(graph.music[0]).toBe(`/${MUSIC_TRACKS[firstTrackIndex(1)]?.file ?? ''}`)
    expect(graph.samplesBase).toBe('/')
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
    engine.tele = { ...TELEMETRY, throttle: true, rpm: 2400 }
    step(snapshot({ t: 1000, km: 0.3 }))
    expect(screen.getByText('出発だね')).toBeInTheDocument()
    expect(graph.notifies).toHaveLength(1)
    const cruising = graph.levels.at(-1)
    expect(cruising?.engine).toBeGreaterThan(0)
    expect(cruising?.music).toBeGreaterThan(0)

    // 16× で 3 行を一度に越える → 3 行が順に出て、通知音は 1 回
    step(snapshot({ t: 60_000, km: 18.5, playback: { rate: 16, paused: false, locked: false } }))
    const texts = [...document.querySelectorAll('.drive-chat__text')].map((n) => n.textContent)
    // 見えるのは新しい 3 行（drive-tourism T8）
    expect(texts).toEqual(['雪だ', 'おやつ', 'いい曲'])
    expect(graph.notifies).toHaveLength(2)
    // 楽しみの行だけに写真（飾り）と出典の平文
    const photos = document.querySelectorAll('.drive-chat__photo')
    expect(photos).toHaveLength(1)
    expect(photos[0]).toHaveAttribute(
      'src',
      expect.stringContaining('photos/red-crowned-crane.jpg'),
    )
    expect(photos[0]).toHaveAttribute('alt', '')
    expect(document.querySelector('.drive-chat__credit')?.textContent).toBe(
      '写真: pakku / CC BY 3.0',
    )

    // ゾーンに入る → 2.5 秒後に zone-enter が出て、琥珀なので 1 音で鳴る（drive-sound-tourism S11 で R8 を変えた）
    step(snapshot({ t: 61_000, km: 19, inZone: true }))
    step(snapshot({ t: 63_600, km: 19.05, inZone: true }))
    expect(screen.getByText(REACTION_TEXT['zone-enter'][0].ja)).toBeInTheDocument()
    expect(graph.notifies).toHaveLength(3)
    expect(graph.notifies[2]?.tones).toBe(1)
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
    engine.tele = { ...TELEMETRY, brake: 1, abs: true }
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
      { ...driveAudioSignals(engine.tele, dangerSnapshot), alert: 'zone' },
      DEFAULT_AUDIO_SETTINGS,
    )
    // ABS の断続が telemetry から届く
    expect(danger?.absHz).toBe(14)
    expect(danger?.music).toBe(0)
    expect(danger?.engine).toBeCloseTo(same.engine / 2)
    expect(danger?.brakeNoise).toBeCloseTo(same.brakeNoise / 2)
    expect(danger?.brakeNoise).toBeGreaterThan(0)
    // AC-1: 強く踏むとタイヤの鳴き（ABS なので 0.6 倍）。赤でも曲は止めず大きさだけ 0
    expect(graph.squeals.length).toBeGreaterThan(0)
    expect(graph.playing()).not.toBeNull()

    // 避けた（赤が終わってから遭遇が avoided になる）→ 赤の後 1.5 秒は待たされ、その後に出る。
    // 琥珀の中なので 1 音で鳴る（S11）
    engine.tele = { ...TELEMETRY }
    step(snapshot({ t: 66_000, km: 19.12, inZone: true, encounters: [avoided] }))
    expect(screen.queryByText(REACTION_TEXT.avoided[0].ja)).not.toBeInTheDocument()
    step(snapshot({ t: 67_600, km: 19.2, inZone: true, encounters: [avoided] }))
    expect(screen.getByText(REACTION_TEXT.avoided[0].ja)).toBeInTheDocument()
    expect(graph.notifies).toHaveLength(4)

    // 見えるのは新しい 3 行まで（drive-tourism T8）
    expect(document.querySelectorAll('.drive-chat__line')).toHaveLength(3)

    // SND-4a: エンジンの合図 collided で衝突音を 1 回だけ鳴らす（同じ走行の 2 回目は鳴らさない）
    engine.cue([{ type: 'collided', deerId: 'd2' }])
    engine.cue([{ type: 'collided', deerId: 'd3' }])
    expect(graph.crashes).toHaveLength(1)

    // 「もう一度」（t が戻る）→ 表示が消え、最初の行がまた出る
    step(snapshot({ t: 0, km: 0, speedKmh: 0 }))
    expect(document.querySelectorAll('.drive-chat__line')).toHaveLength(0)
    step(snapshot({ t: 1000, km: 0.3 }))
    expect(screen.getByText('出発だね')).toBeInTheDocument()
    unlink()
    audio.dispose()
  })
})

describe('AC-2: 見本の場面でゾーンの外を走る（観光の行とおすすめの頻度）', () => {
  it('AC-2: 15 秒ごとに楽しみの行が右上に出て、おすすめのカードが 12 秒ごとに替わる', async () => {
    const scenario = demoScenario(ZONES)
    const engine = new DriveEngine(scenario, ZONES)
    const totalM = engine.world.plan.totalKm * 1000
    const legStartsM = [0, ...scenario.legStarts.map((l) => l.sM)]
    const placed = tourismStops(scenario, totalM)
    const deck = fallbackChatDeck({
      tripId: scenario.trip.id,
      day: scenario.day,
      legStartsM,
      totalM,
      zonesKm: [],
      partySize: scenario.trip.party.size,
      seed: scenario.seed,
      pleasures: placed.map(({ pleasure }) => ({ id: pleasure.id, name: pleasure.name })),
    })
    const track = buildChatTrack(deck, {
      legStartsM,
      totalM,
      partySize: scenario.trip.party.size,
      seed: scenario.seed,
      pleasures: placed.map(({ pleasure, atM }) => ({ id: pleasure.id, name: pleasure.name, atM })),
    })
    const graph = new FakeAudioGraph()
    const audio = new DriveAudio({
      createGraph: () => graph,
      settings: new AudioSettingsStore(null),
      seed: scenario.seed,
    })
    await audio.start()
    const feed = new ChatFeedStore()
    const pushedAtS: number[] = []
    feed.subscribe(() => pushedAtS.push(engine.getSnapshot().t / 1000))
    const unlink = linkDriveSoundAndChat(engine, audio, feed, () => track)
    const tracker = new RecommendTracker(engine, scenario, totalM)
    const offTracker = tracker.subscribe(() => undefined)
    const cards: (string | undefined)[] = []

    // 止まったまま（ゾーンの外）実時間 61 秒
    expect(engine.getSnapshot().zone.gps.status).toBe('outside')
    for (let i = 1; i <= 610; i++) {
      engine.frame(100)
      if (i % 120 === 10) cards.push(tracker.getSnapshot()?.pleasure.id)
    }
    // 楽しみの行（写真つき）が 15 秒ごと
    const lines = feed.getSnapshot().lines
    expect(lines.some((l) => l.pleasure !== null)).toBe(true)
    const gaps = pushedAtS.slice(1).map((s, i) => s - (pushedAtS[i] ?? 0))
    expect(pushedAtS.length).toBeGreaterThanOrEqual(4)
    for (const gap of gaps.slice(1)) expect(gap).toBeCloseTo(15, 0)
    // カードは 12 秒ごとに替わる（見本は到着地の楽しみが 2 つ）
    expect(cards).toHaveLength(6)
    for (let i = 1; i < cards.length; i++) {
      expect(cards[i]).toBeDefined()
      expect(cards[i]).not.toBe(cards[i - 1])
    }
    offTracker()
    unlink()
    audio.dispose()
  })
})
