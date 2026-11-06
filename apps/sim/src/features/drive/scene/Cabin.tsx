import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Color, type Group, MeshBasicMaterial, MeshLambertMaterial, type Mesh } from 'three'
import { CABIN, SKY } from './palette'
import {
  NAV_CENTER,
  WHEEL_CENTER,
  WHEEL_TILT_RAD,
  buildCabinShell,
  buildNavScreen,
  buildWheel,
} from './cabin-models'
import { Dashboard } from './Dashboard'
import { RearMirror } from './RearMirror'
import { PRIORITY, useSceneFrame } from './frame-state'

// 右ハンドルの車内（R10・A3-1）。車に付いて動き、視線（DriverCamera）だけが中で回る。
// ハンドルは A/D で回る。メーター（Dashboard）は速度・回転・ギア・時計・気温・ABS・ナビを canvas の文字盤に出し
// （drive-tune R5。drive-3d の「3D に文字を置かない」を改めた）、ルームミラー（RearMirror）は後ろの映像を映す。
// 車内のスマホは 3D に置かない（drive-crash-spot R2）。drei の Html transform は数十 km の世界の座標を CSS の
// 3D 行列に載せるので、合成の単精度で揺れて 3D の板からずれて浮いて見えた。いまは HUD の層に固定（DrivePage）。

/** ハンドルの最大の切れ角（rad）と、追いつく時定数（s） */
const WHEEL_MAX_RAD = 1.1
const WHEEL_EASE_S = 0.12

export function Cabin() {
  const scene = useSceneFrame()
  const root = useRef<Group>(null)
  const wheel = useRef<Mesh>(null)
  const steer = useRef(0)
  const parts = useMemo(
    () => ({
      shell: buildCabinShell(),
      wheel: buildWheel(),
      nav: buildNavScreen(),
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
    // ルームミラー（PRIORITY.mirror）が同じフレームの行列を読めるように、ここで行列まで更新する
    g.updateMatrixWorld(true)

    materials.interior.emissiveIntensity = SKY[world.light].cabinGlow
    const target = ((world.input.right ? 1 : 0) - (world.input.left ? 1 : 0)) * WHEEL_MAX_RAD
    steer.current += (target - steer.current) * (1 - Math.exp(-Math.min(delta, 0.1) / WHEEL_EASE_S))
    // 右へ切ると時計回り（運転者から見て）。輪は +Z が運転者の方なので rotation.z は負
    if (wheel.current) wheel.current.rotation.z = -steer.current
  }, PRIORITY.place)

  return (
    <group ref={root} name="cabin">
      <mesh geometry={parts.shell} material={materials.interior} />
      <group position={[...WHEEL_CENTER]} rotation={[WHEEL_TILT_RAD, 0, 0]}>
        <mesh ref={wheel} geometry={parts.wheel} material={materials.interior} />
      </group>
      <Dashboard />
      <RearMirror />
      <mesh
        geometry={parts.nav}
        material={materials.lit}
        position={[...NAV_CENTER]}
        rotation={[-0.2, 0.2, 0]}
      />
    </group>
  )
}
