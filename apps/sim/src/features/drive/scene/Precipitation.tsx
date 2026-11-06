import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import {
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Points,
  PointsMaterial,
} from 'three'
import type { Precipitation as PrecipitationKind } from '../domain/season'
import { DRIVER_EYE, PRECIP_LAYER, carToWorld } from './layout'
import { PRECIP, PRECIP_BRIGHTNESS } from './palette'
import { blobTexture } from './mesh-utils'
import {
  createPrecipField,
  stepPrecipField,
  vertexCount,
  writePrecipPositions,
  type PrecipKind,
} from './precip-field'
import { PRIORITY, useSceneFrame } from './frame-state'

// 降るもの（drive-season UC-3e・R6）。雪は Points、雨は LineSegments で、どちらも 1 描画コール。
// 粒の箱は車に付いて動く（位置は運転者の目、向きは車の向き。視線を振っても雪は回らない）。動きは precip-field.ts。
// 光を受けない材質なので、光の区分の明るさ（palette の PRECIP_BRIGHTNESS）を掛けて夜に白く光りすぎないようにする。
// フォグを受ける。降るもののレイヤーは運転者のカメラだけが見る（ルームミラーには描かない。layout の PRECIP_LAYER）。

const BLEND_S = 3
/** 雪の粒の見かけの大きさ（m。ぼかしの点なので実際の雪片より大きめ） */
const SNOW_SIZE_M = 0.14

type Props = { kind: PrecipitationKind; seed: number }

export function Precipitation({ kind, seed }: Props) {
  if (kind === 'none') return null
  return <Falling kind={kind} seed={seed} />
}

function Falling({ kind, seed }: { kind: PrecipKind; seed: number }) {
  const scene = useSceneFrame()
  const field = useMemo(() => createPrecipField(kind, seed), [kind, seed])
  const object = useMemo(() => {
    const geometry = new BufferGeometry()
    const attr = new Float32BufferAttribute(new Float32Array(vertexCount(field) * 3), 3)
    attr.setUsage(DynamicDrawUsage)
    geometry.setAttribute('position', attr)
    const obj =
      kind === 'snow'
        ? new Points(
            geometry,
            new PointsMaterial({
              size: SNOW_SIZE_M,
              sizeAttenuation: true,
              map: blobTexture(16, 16, [[8, 8]], 8),
              transparent: true,
              opacity: PRECIP.snowOpacity,
              depthWrite: false,
            }),
          )
        : new LineSegments(
            geometry,
            new LineBasicMaterial({
              transparent: true,
              opacity: PRECIP.rainOpacity,
              depthWrite: false,
            }),
          )
    obj.name = `precipitation-${kind}`
    obj.layers.set(PRECIP_LAYER)
    // 箱は車に付いているので視錐台の判定は要らない（境界球を毎フレーム作り直さない）
    obj.frustumCulled = false
    obj.matrixAutoUpdate = false
    obj.renderOrder = 1
    return obj
  }, [kind, field])
  // 粒の色と明るさ（明るさは最初のフレームでその光の区分の値にし、あとは寄せる）
  const tint = useMemo(
    () => ({ base: new Color(kind === 'snow' ? PRECIP.snow : PRECIP.rain), level: Number.NaN }),
    [kind],
  )

  // 前のフレームのシミュレーションの時刻と道のり
  const last = useMemo(() => ({ simTimeS: Number.NaN, s: Number.NaN }), [])

  useFrame((state, delta) => {
    const { car, world } = scene.current
    // 運転者のカメラにだけ降るもののレイヤーを見せる（何度呼んでも同じ）
    state.camera.layers.enable(PRECIP_LAYER)
    // 一時停止（シミュレーションの時刻が進まない）なら止める。流れる量は車が実際に進んだ道のり
    const moved = scene.current.simTimeS !== last.simTimeS
    const advance = Number.isNaN(last.s) ? 0 : world.vehicle.s - last.s
    last.simTimeS = scene.current.simTimeS
    last.s = world.vehicle.s
    const speed = moved ? world.vehicle.speed : 0
    stepPrecipField(field, moved ? delta : 0, advance)
    const attr = object.geometry.getAttribute('position') as Float32BufferAttribute
    writePrecipPositions(field, speed, attr.array as Float32Array)
    attr.needsUpdate = true
    object.position.set(...carToWorld(car, DRIVER_EYE))
    object.rotation.set(0, car.yaw, 0)
    object.updateMatrix()
    // 光の区分の明るさへ 3 秒ほどかけて寄せる（空と同じなじませ）
    const goal = PRECIP_BRIGHTNESS[world.light]
    if (Number.isNaN(tint.level)) tint.level = goal
    tint.level += (goal - tint.level) * (1 - Math.exp(-Math.min(delta, 0.1) / BLEND_S))
    const material = object.material as PointsMaterial | LineBasicMaterial
    material.color.copy(tint.base).multiplyScalar(tint.level)
  }, PRIORITY.place)

  return <primitive object={object} />
}
