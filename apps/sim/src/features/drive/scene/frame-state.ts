import { createContext, useContext, type RefObject } from 'react'
import type { World } from '../types'
import type { RoadFrame, RoadPose } from '../domain/road'

// 毎フレーム 1 回だけ求める値（車の位置など）を、シーンの部品で共有する。
// React の state にしない（60 fps で再描画しない）。部品は useFrame の中で current を読む。

/** useFrame の順番（小さいほど先。正の値は自動の描画を止めるので使わない） */
export const PRIORITY = {
  /** メインの engine がシミュレーションを進める */
  simulate: -100,
  /** World を読んで車の位置を求める */
  resolve: -50,
  /** カメラ・車内・光を置く（drei の Html より先に、行列まで更新する） */
  place: -20,
} as const

export type SceneFrame = {
  world: World
  road: RoadFrame
  /** 車の中心の位置と向き */
  car: RoadPose
  /** シミュレーションの時刻（s）。鹿の脚などのアニメーションに使う（一時停止で止まる） */
  simTimeS: number
}

export const SceneFrameContext = createContext<RefObject<SceneFrame> | null>(null)

export function useSceneFrame(): RefObject<SceneFrame> {
  const ref = useContext(SceneFrameContext)
  if (!ref) throw new Error('DriveScene の中で使ってください')
  return ref
}
