import { useThree } from '@react-three/fiber'
import { useState } from 'react'
import { Raycaster, Vector2 } from 'three'
import { pickDeer, spotTargets } from '../domain/spot'
import { useDeerTap } from '../hooks/use-deer-tap'
import { useSceneFrame } from './frame-state'

// 鹿を指す（drive-crash-spot R4・A3-3「左クリック＝鹿を指す。スマホはタップで鹿」）。
// canvas のタップ・クリックの位置から運転者のカメラのレイを引き、見えていてまだ見つけていない鹿の当たりの球
// （domain/spot.ts）から近いものを選んで、id を onSpot に渡す。数えるかはエンジンが決める。何も描かない。

type Props = { onSpot: (deerId: string) => void }

export function DeerPicker({ onSpot }: Props) {
  const scene = useSceneFrame()
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const [tools] = useState(() => ({ raycaster: new Raycaster(), ndc: new Vector2() }))

  useDeerTap(gl.domElement, ({ x, y }) => {
    const { raycaster, ndc } = tools
    raycaster.setFromCamera(ndc.set(x, y), camera)
    const { origin, direction } = raycaster.ray
    const id = pickDeer(
      {
        origin: [origin.x, origin.y, origin.z],
        dir: [direction.x, direction.y, direction.z],
      },
      spotTargets(scene.current.world),
    )
    if (id !== null) onSpot(id)
  })

  return null
}
