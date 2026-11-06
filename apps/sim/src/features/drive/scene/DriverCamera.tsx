import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { easeLook, lookTarget, type Look } from '../domain/look'
import { driveLook } from '../domain/look-input'
import { DRIVER_EYE, EYE_DOWN_RAD, carToWorld } from './layout'
import { PRIORITY, useSceneFrame } from './frame-state'

// 運転者の目（R10・A3-2）。右の席から道の向きを見て、マウスカーソルの位置へヨー ±12°・ピッチ ±6° で視線を寄せる。
// カーソルは R3F の pointer（Canvas の上での位置、-1〜1）。HUD を上に重ねるときは、HUD の層を pointer-events: none に
// しておく（ボタンだけ auto）。そうしないと HUD の上でカーソルを追えない。
// HUD は DOM なのでこのカメラに付いてこない（A3-2）。

export function DriverCamera() {
  const scene = useSceneFrame()
  const look = useRef<Look>({ yaw: 0, pitch: 0 })

  useFrame((state, delta) => {
    const { car } = scene.current
    // 視線の入力: ジャイロ → 指のドラッグ → マウスのカーソル（mobile-landscape R4、domain/look-input.ts）
    const aim = driveLook.target(state.pointer, performance.now())
    look.current = easeLook(look.current, lookTarget(aim.x, aim.y), delta)
    const cam = state.camera
    cam.position.set(...carToWorld(car, DRIVER_EYE))
    // ヨーは右を見るのが正（look.ts）、three.js の rotation.y は左回りが正
    cam.rotation.set(look.current.pitch - EYE_DOWN_RAD, car.yaw - look.current.yaw, 0, 'YXZ')
    // drei の Html（スマホ）が同じフレームのカメラの行列を読めるように
    cam.updateMatrixWorld()
  }, PRIORITY.place)

  return null
}
