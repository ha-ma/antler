import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import { AdditiveBlending, type Group, SpriteMaterial } from 'three'
import type { World } from '../types'
import { DeerModel } from './DeerModel'
import { createDeerAssets } from './deer-models'
import { PRIORITY, useSceneFrame } from './frame-state'

// シーンにいる鹿の一覧。鹿が出た・消えたときだけ React で描き直す（毎フレームは再描画しない）。
// 1 頭は DeerModel 1 つ。形・材質は全頭で共有する。

const PREWARM_FRAMES = 3

function liveIds(world: World): string[] {
  return world.deer.filter((d) => !d.gone).map((d) => d.id)
}

export function DeerHerd() {
  const scene = useSceneFrame()
  const [ids, setIds] = useState<string[]>(() => liveIds(scene.current.world))
  const key = useRef(ids.join(','))
  const assets = useMemo(() => createDeerAssets(), [])

  // 最初の数フレームだけ、鹿の材質を地面の下で 1 回描いてシェーダーを先に作る（最初の鹿が出た瞬間に固まらない）
  const prewarm = useRef<Group>(null)
  const warmFrames = useRef(0)
  const glow = useMemo(
    () =>
      new SpriteMaterial({
        map: assets.eyeshine,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      }),
    [assets],
  )

  useFrame(() => {
    const warm = prewarm.current
    if (warm && warm.visible) {
      const { car } = scene.current
      warm.position.set(car.x, -20, car.z)
      if (++warmFrames.current > PREWARM_FRAMES) warm.visible = false
    }
    const next = liveIds(scene.current.world)
    const k = next.join(',')
    if (k === key.current) return
    key.current = k
    setIds(next)
  }, PRIORITY.resolve + 1)

  return (
    <>
      <group ref={prewarm} name="deer-prewarm">
        <mesh geometry={assets.body} material={assets.coat} frustumCulled={false} />
        <mesh geometry={assets.blob} material={assets.blobMaterial} frustumCulled={false} />
        <sprite material={glow} frustumCulled={false} />
      </group>
      {ids.map((id) => (
        <DeerModel key={id} id={id} assets={assets} />
      ))}
    </>
  )
}
