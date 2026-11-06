import { useFrame, useThree } from '@react-three/fiber'
import { useRef, useState } from 'react'
import type { DriveScenario, World } from '../types'
import { createRoadFrame, poseAt, type RoadFrame } from '../domain/road'
import { sceneLookOf, type SceneLook } from '../domain/season'
import { Precipitation } from './Precipitation'
import { Atmosphere } from './Atmosphere'
import { Cabin } from './Cabin'
import { DeerHerd } from './DeerHerd'
import { DeerPicker } from './DeerPicker'
import { DriverCamera } from './DriverCamera'
import { Forest } from './Forest'
import { Ground } from './Ground'
import { Headlights } from './Headlights'
import { Road } from './Road'
import { PRIORITY, SceneFrameContext, type SceneFrame } from './frame-state'

export type DriveSceneProps = {
  /** 毎フレーム最新の World を返す（メインの engine） */
  world: () => World
  /** 毎フレームの先頭で呼ぶ（実時間 ms）。ここでシミュレーションを進める */
  onFrame: (realDtMs: number) => void
  /**
   * 鹿をクリック / タップした（drive-crash-spot R4）。車内のスマホは 3D に置かず HUD に固定した
   * （drive-crash-spot R2）ので、ここではスマホの中身を受けない
   */
  onSpot: (deerId: string) => void
}

/** Canvas の中身（テストはこれを @react-three/test-renderer で組み立てる） */
export function DriveScene({ world, onFrame, onSpot }: DriveSceneProps) {
  const [road, setRoad] = useState<RoadFrame>(() => createRoadFrame(world().scenario.route))
  const [initial] = useState<SceneFrame>(() => {
    const w = world()
    return { world: w, road, car: poseAt(road, w.vehicle.s, w.vehicle.d), simTimeS: w.t / 1000 }
  })
  const frame = useRef<SceneFrame>(initial)
  // 景色（季節・路面・天候・降るもの。drive-season R3）。場面ごとに 1 回作り、各部品には文字列で渡す
  // （オブジェクトを渡すと再描画のたびに道路・林のキャッシュが捨てられる）
  const [look, setLook] = useState<{ scenario: DriveScenario; look: SceneLook }>(() => {
    const scenario = world().scenario
    return { scenario, look: sceneLookOf(scenario) }
  })
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
    // 場面が変わったら景色を作り直す（値が同じなら state を変えない）
    if (w.scenario !== look.scenario) {
      const next = sceneLookOf(w.scenario)
      const same = (Object.keys(next) as (keyof SceneLook)[]).every((k) => next[k] === look.look[k])
      setLook({ scenario: w.scenario, look: same ? look.look : next })
    }
    const f = frame.current
    f.world = w
    f.road = road
    f.car = poseAt(road, w.vehicle.s, w.vehicle.d)
    f.simTimeS = w.t / 1000
  }, PRIORITY.resolve)

  const { scenario } = world()
  const { season, surface, weather, precipitation } = look.look
  return (
    <SceneFrameContext.Provider value={frame}>
      <Atmosphere weather={weather} />
      <Ground season={season} />
      <Road road={road} surface={surface} season={season} />
      <Forest road={road} seed={scenario.trip.seed} season={season} />
      <Precipitation kind={precipitation} seed={scenario.trip.seed} />
      <Headlights />
      <DeerHerd />
      <Cabin />
      <DriverCamera />
      <DeerPicker onSpot={onSpot} />
    </SceneFrameContext.Provider>
  )
}
