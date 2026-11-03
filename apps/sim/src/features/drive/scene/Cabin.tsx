import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, type ReactNode } from 'react'
import { Color, type Group, MeshBasicMaterial, MeshLambertMaterial, type Mesh } from 'three'
import { CABIN, SKY } from './palette'
import {
  METER_CENTER,
  NAV_CENTER,
  PHONE_CENTER,
  PHONE_TILT_RAD,
  PHONE_YAW_RAD,
  WHEEL_CENTER,
  WHEEL_TILT_RAD,
  buildCabinShell,
  buildNavScreen,
  buildNeedle,
  buildPhoneBody,
  buildWheel,
  meterAngle,
} from './cabin-models'
import { PhoneScreenHtml } from './PhoneScreenHtml'
import { PRIORITY, useSceneFrame } from './frame-state'

// 右ハンドルの車内（R10・A3-1）。車に付いて動き、視線（DriverCamera）だけが中で回る。
// ハンドルは A/D で回り、速度計の針は車の速さを指す。数字は HUD（DOM）が出すので、3D には文字を置かない。

/** ハンドルの最大の切れ角（rad）と、追いつく時定数（s） */
const WHEEL_MAX_RAD = 1.1
const WHEEL_EASE_S = 0.12

type Props = { phone: ReactNode }

export function Cabin({ phone }: Props) {
  const scene = useSceneFrame()
  const root = useRef<Group>(null)
  const wheel = useRef<Mesh>(null)
  const needle = useRef<Mesh>(null)
  const steer = useRef(0)
  const parts = useMemo(
    () => ({
      shell: buildCabinShell(),
      wheel: buildWheel(),
      needle: buildNeedle(),
      nav: buildNavScreen(),
      phone: buildPhoneBody(),
    }),
    [],
  )
  const materials = useMemo(
    () => ({
      // 暗い時間に真っ黒にならないよう、光の区分に合わせて少し自発光させる
      interior: new MeshLambertMaterial({
        vertexColors: true,
        flatShading: true,
        emissive: new Color(CABIN.ambientGlow),
      }),
      // 計器とナビは自分で光る
      lit: new MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    }),
    [],
  )

  useFrame((_, delta) => {
    const g = root.current
    if (!g) return
    const { car, world } = scene.current
    g.position.set(car.x, 0, car.z)
    g.rotation.set(0, car.yaw, 0)
    // drei の Html（スマホの画面）が同じフレームの行列を読めるように、ここで行列まで更新する
    g.updateMatrixWorld(true)

    materials.interior.emissiveIntensity = SKY[world.light].cabinGlow
    const target = ((world.input.right ? 1 : 0) - (world.input.left ? 1 : 0)) * WHEEL_MAX_RAD
    steer.current += (target - steer.current) * (1 - Math.exp(-Math.min(delta, 0.1) / WHEEL_EASE_S))
    // 右へ切ると時計回り（運転者から見て）。輪は +Z が運転者の方なので rotation.z は負
    if (wheel.current) wheel.current.rotation.z = -steer.current
    if (needle.current) needle.current.rotation.z = meterAngle(Math.abs(world.vehicle.speed) * 3.6)
  }, PRIORITY.place)

  return (
    <group ref={root} name="cabin">
      <mesh geometry={parts.shell} material={materials.interior} />
      <group position={[...WHEEL_CENTER]} rotation={[WHEEL_TILT_RAD, 0, 0]}>
        <mesh ref={wheel} geometry={parts.wheel} material={materials.interior} />
      </group>
      <mesh
        ref={needle}
        geometry={parts.needle}
        material={materials.lit}
        position={[...METER_CENTER]}
      />
      <mesh
        geometry={parts.nav}
        material={materials.lit}
        position={[...NAV_CENTER]}
        rotation={[-0.2, 0.2, 0]}
      />
      <group
        position={[...PHONE_CENTER]}
        rotation={[PHONE_TILT_RAD, PHONE_YAW_RAD, 0]}
        rotation-order="YXZ"
      >
        <mesh geometry={parts.phone} material={materials.interior} />
        {phone === null || phone === undefined ? null : <PhoneScreenHtml>{phone}</PhoneScreenHtml>}
      </group>
    </group>
  )
}
