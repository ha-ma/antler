import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import { DynamicDrawUsage, InstancedMesh, MeshLambertMaterial, Object3D } from 'three'
import type { SceneSeason } from '../domain/season'
import type { RoadFrame } from '../domain/road'
import { visibleChunks } from './layout'
import { scatterChunk, type ChunkScatter } from './scatter'
import { buildForestGeometries } from './tree-models'
import { PRIORITY, useSceneFrame } from './frame-state'

// 林と矢羽根（R12: 種類ごとに InstancedMesh 1 つ＝計 4 描画コール。季節によらず 4 つ。drive-season UC-3d）。
// 車の前後の区間の置き場所だけをシード付きで作り、区間の窓が動いたときだけ行列を書き直す。
// 季節が変わったら木の形（雪・葉）だけを差し替える（InstancedMesh と置き場所の行列はそのまま）。

type Kind = keyof ChunkScatter
const KINDS: Kind[] = ['conifer', 'bare', 'birch', 'arrow']
/** 種類ごとの上限（窓は最大 3 区間。区間あたり最大 約 340 本） */
export const FOREST_CAPACITY: Record<Kind, number> = {
  conifer: 1100,
  bare: 650,
  birch: 350,
  arrow: 64,
}

type Props = { road: RoadFrame; seed: number; season: SceneSeason }

export function Forest({ road, seed, season }: Props) {
  const scene = useSceneFrame()
  const material = useMemo(
    () => new MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    [],
  )
  // 季節の木の形（季節が変わったら作り直し、useFrame で差し替えて古い形を捨てる）
  const geometries = useMemo(() => buildForestGeometries(season), [season])
  const meshes = useMemo(() => {
    const out = {} as Record<Kind, InstancedMesh>
    for (const kind of KINDS) {
      const mesh = new InstancedMesh(undefined, material, FOREST_CAPACITY[kind])
      mesh.instanceMatrix.setUsage(DynamicDrawUsage)
      mesh.count = 0
      // 車の周りにしか置かないので、まとめて視錐台の判定を省く
      mesh.frustumCulled = false
      mesh.name = `forest-${kind}`
      out[kind] = mesh
    }
    return out
  }, [material])
  const cache = useMemo(
    () => ({ road, seed, chunks: new Map<number, ChunkScatter>(), range: '' }),
    [road, seed],
  )
  const dummy = useMemo(() => new Object3D(), [])

  useFrame(() => {
    // 形の差し替え（最初のフレームと季節が変わったとき。描く前の useFrame なので空の形は描かれない）
    for (const kind of KINDS) {
      const mesh = meshes[kind]
      if (mesh.geometry === geometries[kind]) continue
      mesh.geometry.dispose()
      mesh.geometry = geometries[kind]
    }
    const { road, seed } = cache
    const [first, last] = visibleChunks(scene.current.world.vehicle.s, road.lengthM)
    const key = `${first}-${last}`
    if (key === cache.range) return
    cache.range = key
    for (const index of cache.chunks.keys()) {
      if (index < first || index > last) cache.chunks.delete(index)
    }
    const counts: Record<Kind, number> = { conifer: 0, bare: 0, birch: 0, arrow: 0 }
    for (let index = first; index <= last; index++) {
      let chunk = cache.chunks.get(index)
      if (!chunk) {
        chunk = scatterChunk(road, index, seed)
        cache.chunks.set(index, chunk)
      }
      for (const kind of KINDS) {
        const mesh = meshes[kind]
        for (const p of chunk[kind]) {
          if (counts[kind] >= FOREST_CAPACITY[kind]) break
          dummy.position.set(p.x, 0, p.z)
          dummy.rotation.set(0, p.yaw, 0)
          dummy.scale.setScalar(p.scale)
          dummy.updateMatrix()
          mesh.setMatrixAt(counts[kind]++, dummy.matrix)
        }
      }
    }
    for (const kind of KINDS) {
      meshes[kind].count = counts[kind]
      meshes[kind].instanceMatrix.needsUpdate = true
    }
  }, PRIORITY.place)

  return (
    <>
      {KINDS.map((kind) => (
        <primitive key={kind} object={meshes[kind]} />
      ))}
    </>
  )
}
