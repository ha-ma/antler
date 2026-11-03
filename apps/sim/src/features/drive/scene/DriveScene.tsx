import { useFrame, useThree } from '@react-three/fiber'
import { useRef, useState, type ReactNode } from 'react'
import type { World } from '../types'
import { createRoadFrame, poseAt, type RoadFrame } from '../domain/road'
import { Atmosphere } from './Atmosphere'
import { Cabin } from './Cabin'
import { DeerHerd } from './DeerHerd'
import { DriverCamera } from './DriverCamera'
import { Forest } from './Forest'
import { Ground } from './Ground'
import { Headlights } from './Headlights'
import { Road } from './Road'
import { PRIORITY, SceneFrameContext, type SceneFrame } from './frame-state'

export type DriveSceneProps = {
  /** 毎フレーム最新の World を返す（メインの engine） */
  world: () => World
  /** 車内のスマホの画面に載せる中身（AlertState compact）。アラート OFF では null */
  phone: ReactNode
  /** 毎フレームの先頭で呼ぶ（実時間 ms）。ここでシミュレーションを進める */
  onFrame: (realDtMs: number) => void
}

/** Canvas の中身（テストはこれを @react-three/test-renderer で組み立てる） */
export function DriveScene({ world, phone, onFrame }: DriveSceneProps) {
  const [road, setRoad] = useState<RoadFrame>(() => createRoadFrame(world().scenario.route))
  const [initial] = useState<SceneFrame>(() => {
    const w = world()
    return { world: w, road, car: poseAt(road, w.vehicle.s, w.vehicle.d), simTimeS: w.t / 1000 }
  })
  const frame = useRef<SceneFrame>(initial)
  // 開発中だけ、描画コール数・三角形数を計測できるように出す（performance-analyzer が読む。本番には入らない）
  const info = useThree((s) => s.gl.info)
  const three = useThree((s) => s.scene)
  if (import.meta.env.DEV)
    Object.assign(globalThis, { __antlerDriveRenderInfo: info, __antlerDriveScene: three })

  useFrame((_, delta) => onFrame(delta * 1000), PRIORITY.simulate)
  useFrame(() => {
    const w = world()
    // 「同じシードでもう一度」などでルートが変わったら作り直す
    if (w.scenario.route !== road.route) {
      setRoad(createRoadFrame(w.scenario.route))
      return
    }
    const f = frame.current
    f.world = w
    f.road = road
    f.car = poseAt(road, w.vehicle.s, w.vehicle.d)
    f.simTimeS = w.t / 1000
  }, PRIORITY.resolve)

  const { scenario } = world()
  return (
    <SceneFrameContext.Provider value={frame}>
      <Atmosphere weather={scenario.weather} />
      <Ground />
      <Road road={road} surface={scenario.surface} />
      <Forest road={road} seed={scenario.trip.seed} />
      <Headlights />
      <DeerHerd />
      <Cabin phone={phone} />
      <DriverCamera />
    </SceneFrameContext.Provider>
  )
}
