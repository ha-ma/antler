import { lazy, memo, Suspense, useCallback, useMemo, useState, type ReactNode } from 'react'
import { DriveEngine } from '../domain/engine'
import { demoScenario } from '../domain/scenario'
import { ZONES } from '../domain/zones-data'
import { useAlertSound } from '../hooks/use-alert-sound'
import { useAutoPause } from '../hooks/use-auto-pause'
import { useDriveSnapshot } from '../hooks/use-drive-snapshot'
import { useKeyboardDrive } from '../hooks/use-keyboard-drive'
import { useWebGL2 } from '../hooks/use-webgl2'
import type { World } from '../types'
import { BottomBar } from './hud/BottomBar'
import { DangerOverlay } from './hud/DangerOverlay'
import { EndBanner } from './hud/EndBanner'
import { HUD_TEXT } from './hud/hud-text'
import { TopBar } from './hud/TopBar'
import { ZoneStatusPanel } from './hud/ZoneStatusPanel'
import { PhoneScreen } from './PhoneScreen'
import { StartOverlay } from './StartOverlay'
import '@antler/alert-ui/tokens.css'
import './drive.css'

// A-3 運転中（3D）と A-5 鹿ゾーン・検知アラートの画面（docs/specs/drive-3d/functional.md）。
// State 設計:
// - Server state: なし（ゾーン DB はビルドに同梱）
// - Shared state: シミュレーション（DriveEngine。HUD とスマホは useSyncExternalStore で購読、3D は毎フレーム読む）
// - Local UI state: エンジン（作るのは 1 回）・出発したか・音トグル（3 個）
// - Form / URL state: URL の ?alert=off（場面を作るときに 1 回読む）
// - useEffect: キー入力・タブの表示・音のコントローラの片づけ（外部の購読。hooks/ に隔離）

// 3D（three・R3F、gzip 約 300 KB）だけを遅れて読む。出発の案内・HUD・エンジンは three なしで先に出す
// （performance-analyzer W-2。出発を押すまでに届けばよい）
const Scene = memo(
  lazy(() => import('../scene/DriveCanvas').then((m) => ({ default: m.DriveCanvas }))),
)

type Props = {
  /** テストで差し替える（既定は固定の場面） */
  createEngine?: () => DriveEngine
  /** テストで差し替える（jsdom には WebGL が無い） */
  canvas?: (props: {
    world: () => World
    phone: ReactNode
    onFrame: (dt: number) => void
  }) => ReactNode
  webgl2?: () => boolean
}

const defaultEngine = () => new DriveEngine(demoScenario(ZONES, window.location.search), ZONES)

export function DrivePage({ createEngine = defaultEngine, canvas, webgl2 }: Props) {
  const [engine] = useState(createEngine)
  const [started, setStarted] = useState(false)
  const [soundOn, setSoundOn] = useState(true)
  const sound = useAlertSound()
  const snapshot = useDriveSnapshot(engine)
  const supported = useWebGL2(webgl2)
  const driving = started && snapshot.outcome === 'driving'
  useKeyboardDrive(engine, driving)
  useAutoPause(engine)

  const world = useCallback(() => engine.world, [engine])
  const onFrame = useCallback(
    (dt: number) => {
      if (started) engine.frame(dt)
    },
    [engine, started],
  )
  const begin = () => {
    void sound.start()
    setStarted(true)
  }
  const retry = () => {
    engine.restart()
    void sound.start()
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
          <ZoneStatusPanel snapshot={snapshot} />
          <TopBar
            snapshot={snapshot}
            onRate={(rate) => engine.setRate(rate)}
            onPause={(paused) => engine.setPaused(paused)}
          />
          {snapshot.alertEnabled && snapshot.outcome === 'driving' && (
            <DangerOverlay alert={snapshot.alert} lang={snapshot.lang} />
          )}
          <BottomBar speedKmh={snapshot.speedKmh} soundOn={soundOn} onSound={setSoundOn} />
          <EndBanner outcome={snapshot.outcome} onRetry={retry} />
        </div>
      )}
      {!started && <StartOverlay alertEnabled={snapshot.alertEnabled} onStart={begin} />}
    </main>
  )
}
