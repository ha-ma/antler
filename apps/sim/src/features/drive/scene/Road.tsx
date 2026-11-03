import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import { Mesh, MeshLambertMaterial } from 'three'
import type { Surface } from '../types'
import type { RoadFrame } from '../domain/road'
import { DRAW_AHEAD_M, DRAW_BEHIND_M, ROAD_CHUNK_M, visibleChunks } from './layout'
import { buildRoadChunk, type RoadChunk } from './road-geometry'
import { PRIORITY, useSceneFrame } from './frame-state'

// 道路（R12）。区間ごとに 1 メッシュ。車の前後の区間だけを作って描き、窓から出た区間は捨てる。
// メッシュは使い回し（POOL 個）で、React の再描画は起きない。

const POOL = Math.ceil((DRAW_AHEAD_M + DRAW_BEHIND_M) / ROAD_CHUNK_M) + 1

type Props = { road: RoadFrame; surface: Surface }

export function Road({ road, surface }: Props) {
  const scene = useSceneFrame()
  const material = useMemo(
    () => new MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    [],
  )
  const pool = useMemo(
    () =>
      Array.from({ length: POOL }, () => {
        const m = new Mesh(undefined, material)
        m.visible = false
        m.matrixAutoUpdate = false
        m.receiveShadow = false
        return m
      }),
    [material],
  )
  // 道路の形のキャッシュ（ルートか路面が変わったら作り直す）
  const cache = useMemo(
    () => ({ road, surface, chunks: new Map<number, RoadChunk>(), range: '' }),
    [road, surface],
  )

  useFrame(() => {
    const { road, surface } = cache
    const [first, last] = visibleChunks(scene.current.world.vehicle.s, road.lengthM)
    const key = `${first}-${last}`
    if (key === cache.range) return
    cache.range = key
    for (const [index, chunk] of cache.chunks) {
      if (index < first || index > last) {
        chunk.geometry.dispose()
        cache.chunks.delete(index)
      }
    }
    pool.forEach((mesh, i) => {
      const index = first + i
      if (index > last) {
        mesh.visible = false
        return
      }
      let chunk = cache.chunks.get(index)
      if (!chunk) {
        chunk = buildRoadChunk(road, index, surface)
        cache.chunks.set(index, chunk)
      }
      mesh.geometry = chunk.geometry
      mesh.position.set(chunk.origin[0], 0, chunk.origin[1])
      mesh.updateMatrix()
      mesh.visible = true
    })
  }, PRIORITY.place)

  return (
    <>
      {pool.map((mesh, i) => (
        <primitive key={i} object={mesh} />
      ))}
    </>
  )
}
