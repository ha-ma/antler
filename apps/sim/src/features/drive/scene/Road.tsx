import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import { Color, Fog, Mesh, MeshPhongMaterial } from 'three'
import type { Surface } from '../types'
import type { SceneSeason } from '../domain/season'
import type { RoadFrame } from '../domain/road'
import { DRAW_AHEAD_M, DRAW_BEHIND_M, ROAD_CHUNK_M, visibleChunks } from './layout'
import { buildRoadChunk, roadMaterialParams, type RoadChunk } from './road-geometry'
import { PRIORITY, useSceneFrame } from './frame-state'

// 道路（R12）。区間ごとに 1 メッシュ。車の前後の区間だけを作って描き、窓から出た区間は捨てる。
// メッシュは使い回し（POOL 個）で、React の再描画は起きない。
// 材質は MeshPhong 1 つ（drive-season UC-3c）。路面が変わっても shininess と specular を書き換えるだけで、
// 材質を作り直さない（作り直すとシェーダーが組み直されて止まる）。

const POOL = Math.ceil((DRAW_AHEAD_M + DRAW_BEHIND_M) / ROAD_CHUNK_M) + 1

type RoadUniforms = { uSkyColor: { value: Color }; uSkyReflect: { value: number } }

/**
 * 車道の材質（MeshPhong に 2 つだけ足す）。
 * 1. 頂点の gloss（車道・轍・線は 1、路肩・法面は 0）を鏡面の光に掛ける（濡れた草の法面が光らない）
 * 2. 濡れ・凍結の車道は、浅い角度ほど空（フォグの色）を映す（フレネルの近似 (1 - N·V)^4）。昼の雨の道が遠くで白く光る
 * フォグは後で掛かるので、遠くの道はいつもどおり霞む。シェーダーは 1 つ（customProgramCacheKey）
 */
function createRoadMaterial(uniforms: RoadUniforms): MeshPhongMaterial {
  const material = new MeshPhongMaterial({ vertexColors: true, flatShading: true })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float gloss;\nvarying float vGloss;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGloss = gloss;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uSkyColor;\nuniform float uSkyReflect;\nvarying float vGloss;',
      )
      .replace(
        '#include <aomap_fragment>',
        '#include <aomap_fragment>\nreflectedLight.directSpecular *= vGloss;',
      )
      .replace(
        '#include <opaque_fragment>',
        [
          'float roadFresnel = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 4.0);',
          'outgoingLight = mix(outgoingLight, uSkyColor, roadFresnel * uSkyReflect * vGloss);',
          '#include <opaque_fragment>',
        ].join('\n'),
      )
  }
  material.customProgramCacheKey = () => 'antler-road-gloss'
  return material
}

type Props = { road: RoadFrame; surface: Surface; season: SceneSeason }

export function Road({ road, surface, season }: Props) {
  const scene = useSceneFrame()
  // 照り返しの uniform（空の色はフォグの色を毎フレーム写す。強さは路面で決める）
  const uniforms = useMemo(
    () => ({ uSkyColor: { value: new Color() }, uSkyReflect: { value: 0 } }),
    [],
  )
  const material = useMemo(() => createRoadMaterial(uniforms), [uniforms])
  const pool = useMemo(
    () =>
      Array.from({ length: POOL }, () => {
        const m = new Mesh(undefined, material)
        m.name = 'road-chunk'
        m.visible = false
        m.matrixAutoUpdate = false
        m.receiveShadow = false
        return m
      }),
    [material],
  )
  // 道路の形のキャッシュ（ルート・路面・景色の季節が変わったら作り直す）
  const cache = useMemo(
    () => ({ road, surface, season, chunks: new Map<number, RoadChunk>(), range: '' }),
    [road, surface, season],
  )

  useFrame((state) => {
    const { road, surface, season } = cache
    if (material.userData.surface !== surface) {
      const params = roadMaterialParams(surface)
      material.shininess = params.shininess
      material.specular.set(params.specular)
      uniforms.uSkyReflect.value = params.skyReflect
      material.userData.surface = surface
    }
    // 空の色の代わりにフォグの色（Atmosphere が光の区分と天候でなじませている地平線の色）を映す
    const fog = state.scene.fog
    if (fog instanceof Fog) uniforms.uSkyColor.value.copy(fog.color)
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
        chunk = buildRoadChunk(road, index, surface, season)
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
