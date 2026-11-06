import { Canvas } from '@react-three/fiber'
import { useState } from 'react'
import { ACESFilmicToneMapping, SRGBColorSpace } from 'three'
import { CAMERA_FAR_M, CAMERA_FOV_DEG, CAMERA_NEAR_M } from './layout'
import { AdaptiveDpr } from './AdaptiveDpr'
import { DriveScene, type DriveSceneProps } from './DriveScene'

// 運転の 3D（A-3・A-5）。親いっぱいに広がる Canvas。HUD はメインが DOM で上に重ねる（ここでは作らない）。
// 性能（R12・ch6）: dpr は 1〜1.5（遅い状態が続けば 1 まで自動で下げる。performance R4）、影なし、木はインスタンス、
// 道路は区間ごと、描くのは車の前後 約 800 m。
// State 設計: Local UI state = dpr（AdaptiveDpr が下げた値。Canvas の prop で持つので、描き直しても戻らない）

export type DriveCanvasProps = DriveSceneProps

/** 最初の DPR の範囲（端末の DPR を 1〜1.5 に収める） */
const DPR_RANGE: [number, number] = [1, 1.5]

export function DriveCanvas({ world, phone, onFrame }: DriveCanvasProps) {
  const [dpr, setDpr] = useState<number | [number, number]>(DPR_RANGE)
  return (
    <Canvas
      dpr={dpr}
      gl={{
        antialias: true,
        powerPreference: 'high-performance',
        toneMapping: ACESFilmicToneMapping,
        outputColorSpace: SRGBColorSpace,
      }}
      camera={{
        fov: CAMERA_FOV_DEG,
        near: CAMERA_NEAR_M,
        far: CAMERA_FAR_M,
        position: [0, 1.2, 0],
      }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <DriveScene world={world} phone={phone} onFrame={onFrame} />
      {/* 遅い状態が続いたら DPR を 1.5 → 1.25 → 1 に下げる（performance R4） */}
      <AdaptiveDpr onDpr={setDpr} />
    </Canvas>
  )
}
