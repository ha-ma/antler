import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Object3D, type SpotLight } from 'three'
import { carToWorld } from './layout'
import { HEADLIGHT, SKY } from './palette'
import { PRIORITY, useSceneFrame } from './frame-state'

// ヘッドライト（ch9 ②: PBR の光）。左右の灯を 1 つのスポットライトにまとめる（ライト 1 つぶんの描画の重さで済む）。
// 光の円錐は eyeshine.ts の BEAM_HALF_DEG（30°）に合わせ、目の反射が光の当たる範囲と食い違わないようにする。
// 影は落とさない: 光源が運転者の目のすぐ前にあるので、鹿の影は鹿自身に隠れて見えない（R12 の性能を優先）。

/** 車の座標（-Z が前）でのライトの位置と、照らす先 */
const LAMP: readonly [number, number, number] = [0, 0.72, -2.15]
const AIM: readonly [number, number, number] = [0, 0.2, -40]
/** 明るさ（cd 相当）と届く距離（m）。physically correct な減衰（decay）は 2 だと遠くの道が暗すぎるので弱める */
const INTENSITY = 900
const DISTANCE_M = 190
const DECAY = 1.2
const ANGLE_RAD = (30 * Math.PI) / 180
const PENUMBRA = 0.55
const BLEND_S = 1.5

export function Headlights() {
  const scene = useSceneFrame()
  const light = useRef<SpotLight>(null)
  const target = useMemo(() => new Object3D(), [])
  const level = useRef(SKY[scene.current.world.light].headlight)

  useFrame((_, delta) => {
    const spot = light.current
    if (!spot) return
    const { car, world } = scene.current
    const goal = SKY[world.light].headlight
    level.current += (goal - level.current) * (1 - Math.exp(-Math.min(delta, 0.1) / BLEND_S))
    // 昼も visible のまま強さだけ 0 にする（ライトの数が変わると、ライトを受ける全マテリアルのシェーダーが
    // 作り直されて止まる。performance-analyzer W-3）
    spot.intensity = level.current > 0.01 ? INTENSITY * level.current : 0
    spot.position.set(...carToWorld(car, LAMP))
    target.position.set(...carToWorld(car, AIM))
    target.updateMatrixWorld()
  }, PRIORITY.place)

  return (
    <>
      <primitive object={target} />
      <spotLight
        ref={light}
        target={target}
        color={HEADLIGHT.color}
        intensity={0}
        distance={DISTANCE_M}
        decay={DECAY}
        angle={ANGLE_RAD}
        penumbra={PENUMBRA}
      />
    </>
  )
}
