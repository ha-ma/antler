import { lazy, memo, Suspense, useCallback, useMemo, useState, type ReactNode } from 'react'
import { AudioControls } from '../audio/AudioControls'
import { ChatFeed } from '../chat/ChatFeed'
import { useDriveSoundAndChat } from '../chat/use-drive-sound-and-chat'
import { DriveEngine } from '../domain/engine'
import { demoScenario } from '../domain/scenario'
import { ZONES } from '../domain/zones-data'
import { useAlertSound } from '../hooks/use-alert-sound'
import { useAutoPause } from '../hooks/use-auto-pause'
import { useDriveSnapshot } from '../hooks/use-drive-snapshot'
import { useKeyboardDrive } from '../hooks/use-keyboard-drive'
import { briefHref } from '../hooks/use-drive-params'
import { useWebGL2 } from '../hooks/use-webgl2'
import type { DriveResult, World } from '../types'
import { BottomBar } from './hud/BottomBar'
import { DangerOverlay } from './hud/DangerOverlay'
import { EndBanner } from './hud/EndBanner'
import { HUD_TEXT } from './hud/hud-text'
import { TopBar } from './hud/TopBar'
import { RecommendCard } from './hud/RecommendCard'
import { RoutePanel } from './hud/RoutePanel'
import { StageBanner } from './hud/StageBanner'
import { ZoneStatusPanel } from './hud/ZoneStatusPanel'
import { loadDriveCanvas } from '../scene/load-drive-canvas'
import { FrameMeter } from './FrameMeter'
import { PhoneScreen } from './PhoneScreen'
import { StartOverlay } from './StartOverlay'
import '@antler/alert-ui/tokens.css'
import './drive.css'

// A-3 運転中（3D）と A-5 鹿ゾーン・検知アラートの画面（docs/specs/drive-3d/functional.md）。
// State 設計:
// - Server state: その日の行程（GET /api/trips/:id/day/:n）は DriveScreen が TanStack Query で読み、場面にして渡す
// - Shared state: シミュレーション（DriveEngine。HUD とスマホは useSyncExternalStore で購読、3D は毎フレーム読む）
// - Local UI state: エンジン（作るのは 1 回）・出発したか・音トグル（3 個）
// - Form / URL state: URL の ?trip・?day・?alert=off（DriveScreen が読み、場面を作るときに 1 回使う）、
//   ?fps=1（開発用の fps の表示。FrameMeter が描くときに 1 回読む。performance R2）
// - useEffect: キー入力・タブの表示・音のコントローラの片づけ（外部の購読。hooks/ に隔離）
// - 運転の音と車内の会話（drive-audio-chat）: useDriveSoundAndChat が音・音量の設定・会話の表示を持ち、
//   会話の束（POST /api/trips/:id/day/:n/chat、TanStack Query）を取る
// - ゾーンの前のおすすめ（drive-tourism）: RecommendCard が自分で RecommendTracker を持ち、エンジンを購読する

// 3D（three・R3F、gzip 約 250 KB。scripts/perf/bundle-budget.mjs の「3d」）だけを遅れて読む。出発の案内・HUD・エンジンは three なしで先に出す
// （performance-analyzer W-2。出発を押すまでに届けばよい）
// A-2 の間に先読みしておく（performance R5。scene/load-drive-canvas.ts の同じ import）
const Scene = memo(lazy(() => loadDriveCanvas().then((m) => ({ default: m.DriveCanvas }))))

type Props = {
  /** テストで差し替える（既定は固定の場面） */
  createEngine?: () => DriveEngine
  /** テストで差し替える（jsdom には WebGL が無い） */
  canvas?:
    | ((props: {
        world: () => World
        phone: ReactNode
        onFrame: (dt: number) => void
      }) => ReactNode)
    | undefined
  webgl2?: (() => boolean) | undefined
  /** 衝突・完走したときに走行の結果を渡す（A-6・A-7 が使う。drive-link R8） */
  onFinish?: ((result: DriveResult) => void) | undefined
}

const defaultEngine = () => new DriveEngine(demoScenario(ZONES, window.location.search), ZONES)

export function DrivePage({ createEngine = defaultEngine, canvas, webgl2, onFinish }: Props) {
  const [engine] = useState(createEngine)
  const [started, setStarted] = useState(false)
  const [soundOn, setSoundOn] = useState(true)
  const sound = useAlertSound()
  const renewSound = sound.renew
  const drive = useDriveSoundAndChat(engine)
  const snapshot = useDriveSnapshot(engine)
  const supported = useWebGL2(webgl2)
  const driving = started && snapshot.outcome === 'driving'
  useKeyboardDrive(engine, driving)
  useAutoPause(engine)

  const world = useCallback(() => engine.world, [engine])
  const onFrame = useCallback(
    (dt: number) => {
      if (!started) return
      const events = engine.frame(dt)
      // ステージを移ったら音のコントローラを作り直す（次のゾーンでチャイムが鳴るように。drive-tune R1）
      if (events.some((e) => e.type === 'stage-clear') && engine.world.outcome === 'driving') {
        void renewSound()
      }
      // 衝突・完走のフレームで 1 回だけ結果を渡す（途中で離れたときは作らない）
      if (onFinish && events.some((e) => e.type === 'collided' || e.type === 'completed')) {
        const result = engine.result()
        if (result) onFinish(result)
      }
    },
    [engine, started, onFinish, renewSound],
  )
  const scenario = engine.world.scenario
  const backToBrief =
    scenario.source === 'trip'
      ? briefHref(scenario.trip.id, scenario.day, scenario.alertEnabled)
      : undefined
  // 運転の音（エンジン・ブレーキ・ラジオ・会話の通知音）もボタンの操作の中で鳴らし始める（自動再生の決まり）
  const begin = () => {
    void sound.start()
    void drive.audio.start()
    setStarted(true)
  }
  const retry = () => {
    engine.restart()
    void sound.start()
    void drive.audio.start()
  }

  // 一時停止・終了・音トグル OFF ではビープと読み上げを止める（R7）
  const muted = !soundOn || snapshot.playback.paused || snapshot.outcome !== 'driving'
  // スマホの中身は自分で購読するので、ここは変わったときだけ作り直す（memo(DriveCanvas) を 10 Hz で破らない）
  const phone = useMemo(
    () =>
      snapshot.alertEnabled ? (
        <PhoneScreen engine={engine} controller={sound.controller} muted={muted} />
      ) : null,
    [snapshot.alertEnabled, engine, sound.controller, muted],
  )

  if (!supported) {
    return (
      <main className="drive" data-theme="night">
        <p className="drive-start" role="alert">
          {HUD_TEXT.noWebgl}
        </p>
      </main>
    )
  }

  return (
    <main className="drive" data-theme="night">
      <div className="drive__scene">
        {canvas ? (
          canvas({ world, phone, onFrame })
        ) : (
          <Suspense fallback={null}>
            <Scene world={world} phone={phone} onFrame={onFrame} />
          </Suspense>
        )}
      </div>
      {started && (
        <div className="drive-hud">
          <div className="drive-hud__left">
            <ZoneStatusPanel snapshot={snapshot} />
            <RoutePanel scenario={scenario} snapshot={snapshot} />
          </div>
          <StageBanner snapshot={snapshot} />
          <TopBar
            snapshot={snapshot}
            onRate={(rate) => engine.setRate(rate)}
            onPause={(paused) => engine.setPaused(paused)}
          />
          {snapshot.alertEnabled && snapshot.outcome === 'driving' && (
            <DangerOverlay alert={snapshot.alert} lang={snapshot.lang} />
          )}
          <BottomBar speedKmh={snapshot.speedKmh} soundOn={soundOn} onSound={setSoundOn} />
          {/* 右の列（drive-tune が --drive-chat-w を空けた）: 右上に車内の会話、右下にゾーンの前のおすすめと
              運転の音の操作（drive-tourism T8・T14） */}
          <div className="drive-chat-column">
            <ChatFeed
              feed={drive.feed}
              lang={snapshot.lang}
              dimmed={snapshot.alert.state === 'danger'}
            />
            <RecommendCard engine={engine} lang={snapshot.lang} />
            <AudioControls settings={drive.settings} lang={snapshot.lang} />
          </div>
          <EndBanner outcome={snapshot.outcome} onRetry={retry} briefHref={backToBrief} />
        </div>
      )}
      {!started && (
        <StartOverlay scenario={scenario} noZone={snapshot.stage.count === 0} onStart={begin} />
      )}
      {/* 開発用の fps の表示（?fps=1 のときだけ。performance R2） */}
      <FrameMeter engine={engine} />
    </main>
  )
}
