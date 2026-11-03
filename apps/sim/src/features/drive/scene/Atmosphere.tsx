import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import {
  BackSide,
  Color,
  type DirectionalLight,
  Float32BufferAttribute,
  type Fog,
  type HemisphereLight,
  type Mesh,
  MeshBasicMaterial,
  SphereGeometry,
} from 'three'
import type { Weather } from '../types'
import { CAMERA_FAR_M } from './layout'
import { SKY, WEATHER_FOG } from './palette'
import { PRIORITY, useSceneFrame } from './frame-state'

// 空・フォグ・環境光（光の区分 world.light で変える）。区分が変わったら 3 秒ほどかけて寄せる（急に暗くならない）。
// 空は頂点色のグラデーションの球（1 描画コール）をカメラに付けて動かす。フォグは描画の窓（layout.ts）の端を隠す。

const BLEND_S = 3
const DOME_R = CAMERA_FAR_M * 0.8

type Props = { weather: Weather }

export function Atmosphere({ weather }: Props) {
  const scene = useSceneFrame()
  const fog = useRef<Fog>(null)
  const hemi = useRef<HemisphereLight>(null)
  const sun = useRef<DirectionalLight>(null)
  const dome = useRef<Mesh>(null)
  // 初期値は最初の 1 回だけ読む（再描画で読み直すと、なじませの途中の値と args が作り直されて 3 秒のなじませが飛ぶ）。
  // 光の区分の変化は useFrame の中だけで寄せる
  const [start] = useState(() => SKY[scene.current.world.light])

  const domeGeometry = useMemo(() => {
    const g = new SphereGeometry(DOME_R, 16, 10)
    g.setAttribute(
      'color',
      new Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 3), 3),
    )
    return g
  }, [])
  const domeMaterial = useMemo(
    () =>
      new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }),
    [],
  )
  // 寄せていく途中の値
  const now = useMemo(
    () => ({
      zenith: new Color(start.zenith),
      horizon: new Color(start.horizon),
      fog: new Color(start.fog),
      fogNear: start.fogNear,
      fogFar: start.fogFar,
      hemiIntensity: start.hemiIntensity,
      sunIntensity: start.sunIntensity,
      painted: '',
    }),
    [start],
  )
  const target = useMemo(
    () => ({ zenith: new Color(), horizon: new Color(), fog: new Color() }),
    [],
  )

  useFrame((state, delta) => {
    const look = SKY[scene.current.world.light]
    const k = 1 - Math.exp(-Math.min(delta, 0.1) / BLEND_S)
    target.zenith.set(look.zenith)
    target.horizon.set(look.horizon)
    target.fog.set(look.fog)
    now.zenith.lerp(target.zenith, k)
    now.horizon.lerp(target.horizon, k)
    now.fog.lerp(target.fog, k)
    const w = WEATHER_FOG[weather]
    now.fogNear += (look.fogNear * w - now.fogNear) * k
    now.fogFar += (look.fogFar * w - now.fogFar) * k
    now.hemiIntensity += (look.hemiIntensity - now.hemiIntensity) * k
    now.sunIntensity += (look.sunIntensity - now.sunIntensity) * k

    if (fog.current) {
      fog.current.color.copy(now.fog)
      fog.current.near = now.fogNear
      fog.current.far = now.fogFar
    }
    if (state.scene.background instanceof Color) state.scene.background.copy(now.fog)
    if (hemi.current) {
      hemi.current.color.set(look.hemiSky)
      hemi.current.groundColor.set(look.hemiGround)
      hemi.current.intensity = now.hemiIntensity
    }
    const car = scene.current.car
    if (sun.current) {
      sun.current.color.set(look.sun)
      sun.current.intensity = now.sunIntensity
      // 南西の低い空（2 月の夕方）から照らす
      const r = 300
      sun.current.position.set(
        car.x - r * 0.6,
        r * Math.sin(look.sunElevation) + 20,
        car.z + r * 0.8,
      )
      sun.current.target.position.set(car.x, 0, car.z)
      sun.current.target.updateMatrixWorld()
    }
    if (dome.current) {
      dome.current.position.copy(state.camera.position)
      // 色が目に見えて変わったときだけ頂点色を塗り直す
      const key = now.zenith.getHexString() + now.horizon.getHexString()
      if (key !== now.painted) {
        paintDome(domeGeometry, now.zenith, now.horizon, now.fog)
        now.painted = key
      }
    }
  }, PRIORITY.place)

  return (
    <>
      <fog ref={fog} attach="fog" args={[start.fog, start.fogNear, start.fogFar]} />
      <color attach="background" args={[start.fog]} />
      <hemisphereLight ref={hemi} args={[start.hemiSky, start.hemiGround, start.hemiIntensity]} />
      <directionalLight ref={sun} args={[start.sun, start.sunIntensity]} />
      <mesh
        ref={dome}
        geometry={domeGeometry}
        material={domeMaterial}
        renderOrder={-1}
        frustumCulled={false}
      />
    </>
  )
}

/** 天頂 → 地平線の色。地平線より下はフォグの色（遠くの雪原と溶け合う） */
function paintDome(g: SphereGeometry, zenith: Color, horizon: Color, fog: Color): void {
  const pos = g.getAttribute('position')
  const col = g.getAttribute('color')
  const c = new Color()
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i) / DOME_R
    if (h <= 0.02) c.copy(fog)
    else c.copy(horizon).lerp(zenith, Math.min(1, (h - 0.02) / 0.6) ** 0.7)
    col.setXYZ(i, c.r, c.g, c.b)
  }
  col.needsUpdate = true
}
