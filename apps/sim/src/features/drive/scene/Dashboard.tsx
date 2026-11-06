import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { type CanvasTexture, LinearFilter, type Mesh, SRGBColorSpace } from 'three'
import { dashboardOf } from '../domain/dashboard'
import { METER_CENTER, buildNeedle } from './cabin-models'
import {
  CLUSTER_PX,
  CLUSTER_SIZE_M,
  NEEDLE_M,
  SPEED_DIAL,
  TACH_DIAL,
  clusterPxToM,
  paintCluster,
  rpmAngle,
  speedAngle,
} from './dashboard-paint'
import { dashboardKey, formatDashboard } from './dashboard-text'
import { PRIORITY, useSceneFrame } from './frame-state'

// 運転席のメーター（drive-tune R5・UC-4b〜UC-4d）。車内の物なので車と視線に付いて動く（HUD ではない。A3-2）。
// 毎フレーム dashboardOf(world) を読み、針（速度・回転）は毎フレーム回す。文字盤の canvas は、表示の文字
// （速さ・ギア・時計・気温・ABS・ナビ）が変わったときだけ、多くても 1 秒に 12 回描き直す（React は再描画しない）。

/** 文字盤を描き直す最短の間隔（s）。ABS の点灯と消灯は待たない */
const MIN_REPAINT_S = 1 / 12
/** 板の前面（文字盤の箱の前面 z −0.305 の少し前） */
const FACE_Z = METER_CENTER[2] - 0.0035

const TACH_AT = clusterPxToM(TACH_DIAL.cx, TACH_DIAL.cy)
const SPEED_AT = clusterPxToM(SPEED_DIAL.cx, SPEED_DIAL.cy)

type Paint = {
  key: string
  abs: boolean
  since: number
  fontStatus: string | undefined
}

export function Dashboard() {
  const scene = useSceneFrame()
  const speedNeedle = useRef<Mesh>(null)
  const tachNeedle = useRef<Mesh>(null)
  const texture = useRef<CanvasTexture>(null)
  const needle = useMemo(() => buildNeedle(NEEDLE_M), [])
  const surface = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = CLUSTER_PX[0]
    canvas.height = CLUSTER_PX[1]
    // jsdom（テスト）では null。そのときは描かずに組み立てだけする
    return { canvas, ctx: canvas.getContext('2d') }
  }, [])
  const painted = useRef<Paint>({ key: '', abs: false, since: Infinity, fontStatus: undefined })

  useFrame((_, delta) => {
    const d = dashboardOf(scene.current.world)
    if (speedNeedle.current) speedNeedle.current.rotation.z = speedAngle(d.speedKmh)
    if (tachNeedle.current) tachNeedle.current.rotation.z = rpmAngle(d.rpm)

    const p = painted.current
    p.since += delta
    // Web フォント（IBM Plex Mono・Noto Sans JP）が読み終わったら描き直す（最初は代わりの字体で描かれる）
    const fontStatus = typeof document === 'undefined' ? undefined : document.fonts?.status
    if (fontStatus !== p.fontStatus) {
      p.fontStatus = fontStatus
      p.key = ''
    }
    const text = formatDashboard(d)
    const key = dashboardKey(text)
    if (key === p.key) return
    if (p.since < MIN_REPAINT_S && text.abs === p.abs && p.key !== '') return
    if (!surface.ctx || !texture.current) return
    p.key = key
    p.abs = text.abs
    p.since = 0
    paintCluster(surface.ctx, text)
    texture.current.needsUpdate = true
  }, PRIORITY.place)

  return (
    <group name="dashboard">
      <mesh position={[METER_CENTER[0], METER_CENTER[1], FACE_Z]}>
        <planeGeometry args={[CLUSTER_SIZE_M[0], CLUSTER_SIZE_M[1]]} />
        {/* 計器は自分で光る（暗い時間も読める）。色は canvas のまま（トーンマップしない） */}
        <meshBasicMaterial toneMapped={false}>
          <canvasTexture
            ref={texture}
            attach="map"
            args={[surface.canvas]}
            colorSpace={SRGBColorSpace}
            minFilter={LinearFilter}
            generateMipmaps={false}
            anisotropy={4}
          />
        </meshBasicMaterial>
      </mesh>
      <mesh
        ref={tachNeedle}
        name="tach-needle"
        geometry={needle}
        position={[METER_CENTER[0] + TACH_AT[0], METER_CENTER[1] + TACH_AT[1], FACE_Z]}
      >
        <meshBasicMaterial vertexColors toneMapped={false} />
      </mesh>
      <mesh
        ref={speedNeedle}
        name="speed-needle"
        geometry={needle}
        position={[METER_CENTER[0] + SPEED_AT[0], METER_CENTER[1] + SPEED_AT[1], FACE_Z]}
      >
        <meshBasicMaterial vertexColors toneMapped={false} />
      </mesh>
    </group>
  )
}
