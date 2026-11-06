import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { DriveEngine } from '../domain/engine'
import { deviceDirection } from '../domain/gyro-look'
import { InputMixer, type InputTarget } from '../domain/input-mix'
import { driveLook } from '../domain/look-input'
import { requestGyroPermission } from './gyro-permission'
import {
  ANY_TOUCH_QUERY,
  PORTRAIT_TOUCH_QUERY,
  PRIMARY_TOUCH_QUERY,
  useMediaQuery,
} from './use-media-query'

// スマホの横画面で運転する（docs/specs/mobile-landscape/functional.md R2〜R4）。
// State 設計:
// - キーと指の入力を合わせる口（InputMixer。作るのは 1 回）
// - 指で操る端末か・主のポインタが指か・縦か（matchMedia の購読。useMediaQuery）
// - ジャイロの許可（「出発」の操作の中で聞き、結果だけを持つ）と、ジャイロを使うかの切り替え（useState 2 つ）
// - 視線（driveLook。60 fps で読むので React の state にしない）
// - useEffect: deviceorientation と縦の変化の購読、画面を離れるときの片づけ（外部の購読）

type SceneLookHandlers = {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void
}

export type MobileDrive = {
  /** 指で触れるポインタがある（円を出す） */
  touch: boolean
  /** 主のポインタが指（キーの説明の代わりに指の説明） */
  touchPrimary: boolean
  /** 主のポインタが指で縦（ローテーションの案内） */
  portrait: boolean
  /** useKeyboardDrive に渡す口 */
  keysInput: InputTarget
  /** 左右の円に渡す口 */
  touchInput: InputTarget
  /** 「出発」「もう一度」の操作の中で同期的に呼ぶ（iOS の許可） */
  askGyro: () => void
  /** ジャイロの視線を使うか（WCAG 2.5.4。既定 ON） */
  gyroOn: boolean
  setGyroOn: (on: boolean) => void
  /** 運転画面（Canvas の親）に付ける。指のドラッグで視線、マウスならカーソルに戻す */
  sceneLook: SceneLookHandlers
}

export function useMobileDrive(engine: DriveEngine, driving: boolean): MobileDrive {
  const [inputs] = useState(() => {
    const mixer = new InputMixer(engine)
    return { keys: mixer.source('keys'), touch: mixer.source('touch') }
  })
  const touch = useMediaQuery(ANY_TOUCH_QUERY)
  const touchPrimary = useMediaQuery(PRIMARY_TOUCH_QUERY)
  const portrait = useMediaQuery(PORTRAIT_TOUCH_QUERY)
  const [gyroAllowed, setGyroAllowed] = useState(false)
  // ジャイロの視線を使うか（WCAG 2.5.4。出発の案内で切れる。OFF ならドラッグの視線だけ）
  const [gyroOn, setGyroOn] = useState(true)
  useGyroLook(gyroAllowed && gyroOn && touch && driving)
  usePortraitPause(engine, driving)
  const sceneLook = useSceneLook()

  const askGyro = () => {
    if (!touch || !gyroOn) return
    // 「もう一度」でも基準を取り直す
    driveLook.gyro.clear()
    void requestGyroPermission().then(setGyroAllowed)
  }

  return {
    touch,
    touchPrimary,
    portrait,
    keysInput: inputs.keys,
    touchInput: inputs.touch,
    askGyro,
    gyroOn,
    setGyroOn,
    sceneLook,
  }
}

/** 端末の向きを聞いて視線に渡す（R4）。止めたら基準を捨てる */
function useGyroLook(enabled: boolean): void {
  // eslint-disable-next-line no-restricted-syntax -- window の deviceorientation の購読（外部イベント）
  useEffect(() => {
    if (!enabled) return undefined
    const onOrientation = (e: DeviceOrientationEvent) => {
      if (e.beta === null || e.gamma === null) return
      driveLook.gyro.push(deviceDirection(e.alpha ?? 0, e.beta, e.gamma), performance.now())
    }
    window.addEventListener('deviceorientation', onOrientation)
    return () => {
      window.removeEventListener('deviceorientation', onOrientation)
      driveLook.gyro.clear()
    }
  }, [enabled])
}

/** 走っている途中で縦になったら一時停止する（R2。横に戻しても自動では再開しない） */
function usePortraitPause(engine: DriveEngine, driving: boolean): void {
  // eslint-disable-next-line no-restricted-syntax -- matchMedia の変化の購読（外部イベント）
  useEffect(() => {
    if (!driving || typeof window.matchMedia !== 'function') return undefined
    const list = window.matchMedia(PORTRAIT_TOUCH_QUERY)
    const onChange = () => {
      if (list.matches) engine.setPaused(true)
    }
    onChange()
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [engine, driving])
}

/** 指のドラッグの視線（R4。ジャイロが無いとき）。画面の幅の半分で右いっぱい、離したら正面 */
function useSceneLook(): SceneLookHandlers {
  const drag = useRef<{ id: number; x: number; y: number; w: number; h: number } | null>(null)

  // 画面を離れるときに視線の入力を捨てる（次の運転画面に持ち越さない）
  // eslint-disable-next-line no-restricted-syntax -- モジュールの外の視線の入力の片づけ
  useEffect(() => () => driveLook.reset(), [])

  const end = (e: ReactPointerEvent<HTMLElement>) => {
    if (drag.current?.id !== e.pointerId) return
    drag.current = null
    driveLook.release()
  }
  return {
    onPointerDown: (e) => {
      // 新しい指で始め直す（前の指の pointerup を取りこぼしても固まらない。code-reviewer W1）
      if (e.pointerType !== 'touch') return
      const el = e.currentTarget
      drag.current = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        w: Math.max(1, el.clientWidth / 2),
        h: Math.max(1, el.clientHeight / 2),
      }
      driveLook.dragTo(0, 0)
    },
    onPointerMove: (e) => {
      if (e.pointerType === 'mouse') {
        driveLook.mouse()
        return
      }
      const d = drag.current
      if (!d || d.id !== e.pointerId) return
      driveLook.dragTo((e.clientX - d.x) / d.w, -(e.clientY - d.y) / d.h)
    },
    onPointerUp: end,
    onPointerCancel: end,
  }
}
