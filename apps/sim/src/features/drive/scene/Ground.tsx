import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { MeshLambertMaterial, type Mesh, PlaneGeometry } from 'three'
import type { SceneSeason } from '../domain/season'
import { SEASON } from './palette'
import { PRIORITY, useSceneFrame } from './frame-state'

// 地面（冬は雪原、ほかの季節は草地。drive-season UC-3b）。車の周りに大きな板を 1 枚置いて、車に付いて動かす
// （ルート全体に地面を持たない）。道路（y = 0）より少し下げ、polygonOffset で奥へ押して、遠くでも道路とちらつかない。

const SIZE_M = 2400
const SNAP_M = 50

type Props = { season: SceneSeason }

export function Ground({ season }: Props) {
  const scene = useSceneFrame()
  const mesh = useRef<Mesh>(null)
  const geometry = useMemo(() => new PlaneGeometry(SIZE_M, SIZE_M).rotateX(-Math.PI / 2), [])
  // 季節が変わると作り直す（同じ種類の材質なので three.js がシェーダーを使い回す）
  const material = useMemo(
    () =>
      new MeshLambertMaterial({
        color: SEASON[season].ground,
        polygonOffset: true,
        polygonOffsetFactor: 2,
        polygonOffsetUnits: 4,
      }),
    [season],
  )
  useFrame(() => {
    const car = scene.current.car
    mesh.current?.position.set(
      Math.round(car.x / SNAP_M) * SNAP_M,
      -0.03,
      Math.round(car.z / SNAP_M) * SNAP_M,
    )
  }, PRIORITY.place)
  return <mesh ref={mesh} name="ground" geometry={geometry} material={material} />
}
