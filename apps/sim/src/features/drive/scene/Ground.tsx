import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { MeshLambertMaterial, type Mesh, PlaneGeometry } from 'three'
import { TERRAIN } from './palette'
import { PRIORITY, useSceneFrame } from './frame-state'

// 雪原。車の周りに大きな板を 1 枚置いて、車に付いて動かす（ルート全体に地面を持たない）。
// 道路（y = 0）より少し下げ、polygonOffset で奥へ押して、遠くでも道路とちらつかない。

const SIZE_M = 2400
const SNAP_M = 50

export function Ground() {
  const scene = useSceneFrame()
  const mesh = useRef<Mesh>(null)
  const geometry = useMemo(() => new PlaneGeometry(SIZE_M, SIZE_M).rotateX(-Math.PI / 2), [])
  const material = useMemo(
    () =>
      new MeshLambertMaterial({
        color: TERRAIN.snowField,
        polygonOffset: true,
        polygonOffsetFactor: 2,
        polygonOffsetUnits: 4,
      }),
    [],
  )
  useFrame(() => {
    const car = scene.current.car
    mesh.current?.position.set(
      Math.round(car.x / SNAP_M) * SNAP_M,
      -0.03,
      Math.round(car.z / SNAP_M) * SNAP_M,
    )
  }, PRIORITY.place)
  return <mesh ref={mesh} geometry={geometry} material={material} />
}
