import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { crashShake, type CameraShake } from '../domain/crash'
import { easeLook, lookTarget, type Look } from '../domain/look'
import { driveLook } from '../domain/look-input'
import { DRIVER_EYE, EYE_DOWN_RAD, carToWorld } from './layout'
import { PRIORITY, useSceneFrame } from './frame-state'

// 運転者の目（R10・A3-2）。右の席から道の向きを見て、マウスカーソルの位置へヨー ±12°・ピッチ ±6° で視線を寄せる。
// カーソルは R3F の pointer（Canvas の上での位置、-1〜1）。HUD を上に重ねるときは、HUD の層を pointer-events: none に
// しておく（ボタンだけ auto）。そうしないと HUD の上でカーソルを追えない。
// HUD は DOM なのでこのカメラに付いてこない（A3-2）。

const NO_SHAKE: CameraShake = { yaw: 0, pitch: 0, roll: 0 }

/** 動きを減らす設定か（衝突のたびに 1 回だけ読む。matchMedia の無い環境では減らさない） */
function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
}

export function DriverCamera() {
  const scene = useSceneFrame()
  const look = useRef<Look>({ yaw: 0, pitch: 0 })
  // 衝突した実時間（performance.now）と reduced-motion（drive-crash-spot R3）。world.t は衝突で止まるので実時間で測る
  const crash = useRef<{ at: number; reduced: boolean } | null>(null)

  useFrame((state, delta) => {
    const { car, world } = scene.current
    const now = performance.now()
    // 視線の入力: ジャイロ → 指のドラッグ → マウスのカーソル（mobile-landscape R4、domain/look-input.ts）
    const aim = driveLook.target(state.pointer, now)
    look.current = easeLook(look.current, lookTarget(aim.x, aim.y), delta)
    if (world.outcome !== 'collided') crash.current = null
    else crash.current ??= { at: now, reduced: prefersReducedMotion() }
    const shake = crash.current
      ? crashShake((now - crash.current.at) / 1000, crash.current.reduced)
      : NO_SHAKE
    const cam = state.camera
    cam.position.set(...carToWorld(car, DRIVER_EYE))
    // ヨーは右を見るのが正（look.ts）、three.js の rotation.y は左回りが正
    cam.rotation.set(
      look.current.pitch - EYE_DOWN_RAD + shake.pitch,
      car.yaw - look.current.yaw - shake.yaw,
      shake.roll,
      'YXZ',
    )
    // 鹿を指すレイ（DeerPicker）とルームミラーが同じフレームのカメラの行列を読めるように
    cam.updateMatrixWorld()
  }, PRIORITY.place)

  return null
}
