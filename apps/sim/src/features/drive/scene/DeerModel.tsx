import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { AdditiveBlending, type Group, type Mesh, type Sprite, SpriteMaterial } from 'three'
import { deerEyeshine, gazeHeading } from '../domain/eyeshine'
import { deerPlacement } from './layout'
import { DEER, SKY } from './palette'
import {
  EYES_FROM_NECK,
  LEGS,
  LEG_PIVOT_Y,
  NECK_PIVOT,
  deerLooks,
  type DeerAssets,
} from './deer-models'
import { PRIORITY, useSceneFrame } from './frame-state'

// 鹿 1 頭（ch9 ③ 仮採用 c＋d が決まるまでの自作のローポリ。差し替えるときはこの部品だけを替える）。
// 入力は World の鹿（id で引く）。位置・向き・脚の動き（idle / walk / run / look）・首の向き・目の反射を毎フレーム置く。
// 目の反射は eyeshine.ts の強さ（ヘッドライトの向きと鹿の目への向きの内積）を、加算合成の光の板の濃さにする。

type Props = { id: string; assets: DeerAssets }

/** 姿勢ごとの首の上下（rad、正は鼻先が上） */
const HEAD_PITCH = { idle: -1.05, look: 0.12, walk: -0.22, run: -0.05 } as const
const GAIT = { walk: { hz: 1.5, amp: 0.38 }, run: { hz: 2.7, amp: 0.7 } } as const
/** 首の動きの時定数（s） */
const HEAD_EASE_S = 0.35
/** 目の反射の光の板の大きさ: 近くは目の幅、遠くは画面で数ピクセルを保つ */
const GLOW_MIN_M = 0.16
const GLOW_PER_M = 0.0075

export function DeerModel({ id, assets }: Props) {
  const scene = useSceneFrame()
  const root = useRef<Group>(null)
  const head = useRef<Group>(null)
  const glow = useRef<Sprite>(null)
  const legs = useRef<(Mesh | null)[]>([])
  const looks = useMemo(() => deerLooks(id), [id])
  const glowMaterial = useMemo(
    () =>
      new SpriteMaterial({
        map: assets.eyeshine,
        color: DEER.eyeshine,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        fog: false,
        toneMapped: false,
        opacity: 0,
      }),
    [assets],
  )

  useFrame((state, delta) => {
    const g = root.current
    if (!g) return
    const { world, road, simTimeS } = scene.current
    const deer = world.deer.find((d) => d.id === id)
    if (!deer || deer.gone) {
      g.visible = false
      return
    }
    g.visible = true
    const p = deerPlacement(road, deer)
    const moving = deer.pose === 'walk' || deer.pose === 'run'
    const gait = deer.pose === 'run' ? GAIT.run : GAIT.walk
    const phase = simTimeS * gait.hz * Math.PI * 2 + looks.phase
    // 走るときは体が弾む
    const bob = deer.pose === 'run' ? Math.abs(Math.sin(phase)) * 0.06 : 0
    g.position.set(p.x, p.y + bob, p.z)
    g.rotation.y = p.yaw

    // 脚: 対角の脚が同じ位相（前左と後右、前右と後左）
    legs.current.forEach((leg, i) => {
      if (!leg) return
      const diagonal = i === 0 || i === 3 ? 0 : Math.PI
      leg.rotation.x = moving ? Math.sin(phase + diagonal) * gait.amp : 0
    })

    // 首: 草をはむ（idle）・顔を上げて車を見る（look）・歩く走る
    const h = head.current
    const { vehicle } = world
    if (h) {
      const k = 1 - Math.exp(-Math.min(delta, 0.1) / HEAD_EASE_S)
      const graze = deer.pose === 'idle' ? Math.sin(simTimeS * 0.8 + looks.phase) * 0.1 : 0
      h.rotation.x += (HEAD_PITCH[deer.pose] + graze - h.rotation.x) * k
      const yaw = -(gazeHeading(deer, vehicle.s, vehicle.d) - deer.heading)
      h.rotation.y += (yaw - h.rotation.y) * k
    }

    // 目の反射
    const sprite = glow.current
    if (sprite) {
      // ヘッドライトを点けない昼は光らない
      const strength = deerEyeshine(deer, vehicle.s, vehicle.d) * SKY[world.light].headlight
      sprite.visible = strength > 0.02
      glowMaterial.opacity = Math.min(1, strength * 1.2)
      const dist = state.camera.position.distanceTo(g.position)
      const size = Math.max(GLOW_MIN_M, dist * GLOW_PER_M)
      sprite.scale.set(size * 2, size, 1)
    }
  }, PRIORITY.place)

  return (
    <group ref={root} name="deer" userData={{ deerId: id }} visible={false}>
      <mesh geometry={assets.body} material={assets.coat} />
      <group ref={head} position={[...NECK_PIVOT]} rotation-order="YXZ">
        <mesh geometry={looks.buck ? assets.headBuck : assets.headDoe} material={assets.coat} />
        <sprite ref={glow} material={glowMaterial} position={[...EYES_FROM_NECK]} visible={false} />
      </group>
      {LEGS.map(([x, z], i) => (
        <mesh
          key={i}
          ref={(m) => {
            legs.current[i] = m
          }}
          geometry={assets.leg}
          material={assets.coat}
          position={[x, LEG_PIVOT_Y, z]}
        />
      ))}
      <mesh geometry={assets.blob} material={assets.blobMaterial} position={[0, 0.02, 0]} />
    </group>
  )
}
