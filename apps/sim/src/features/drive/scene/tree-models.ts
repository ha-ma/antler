import { BoxGeometry, Color, ConeGeometry, CylinderGeometry, type BufferGeometry } from 'three'
import { ARROW_D_M } from './scatter'
import { LANE_EDGE_M } from './layout'
import { TERRAIN, TREE } from './palette'
import { merge, mix, paint, smoothstep } from './mesh-utils'

// 林と矢羽根のローポリ（自作。コードで作る）。原点は根元、+Y が上。InstancedMesh で使い回す。

const SNOW = new Color(TREE.coniferSnow)

/** トドマツ・エゾマツ（3 段の円錐、先に雪）。高さ約 12 m */
export function buildConifer(): BufferGeometry {
  const parts: BufferGeometry[] = [
    paint(new CylinderGeometry(0.18, 0.3, 2.4, 5, 1, true).translate(0, 1.2, 0), TREE.coniferTrunk),
  ]
  const tiers: [radius: number, height: number, base: number][] = [
    [2.7, 5.2, 1.6],
    [2.1, 4.6, 4.6],
    [1.4, 4.2, 7.6],
  ]
  tiers.forEach(([radius, height, base], i) => {
    const cone = new ConeGeometry(radius, height, 7, 1, true).translate(0, base + height / 2, 0)
    parts.push(
      paint(cone, (_x, y) => {
        const t = (y - base) / height
        const green = mix(TREE.conifer, TREE.coniferLight, i / 2)
        return green.lerp(SNOW, smoothstep(0.5, 1, t) * 0.85)
      }),
    )
  })
  return merge(parts)
}

/** 葉の落ちた広葉樹（ミズナラ）かシラカバ。高さ約 10 m */
export function buildBareTree(birch: boolean): BufferGeometry {
  const trunkColor = birch ? TREE.birchTrunk : TREE.bareTrunk
  const parts: BufferGeometry[] = [
    paint(
      new CylinderGeometry(birch ? 0.09 : 0.12, birch ? 0.16 : 0.24, 10, 5, 1, true).translate(
        0,
        5,
        0,
      ),
      trunkColor,
    ),
  ]
  // 斜めに伸びる枝（4 本）
  const branches: [height: number, angle: number, yaw: number, length: number][] = [
    [4.2, 0.7, 0.3, 3.2],
    [5.4, 0.6, 2.2, 3.0],
    [6.6, 0.55, 4.1, 2.6],
    [7.6, 0.5, 5.4, 2.2],
  ]
  for (const [height, angle, yaw, length] of branches) {
    const branch = new CylinderGeometry(0.03, 0.07, length, 4, 1, true)
      .translate(0, length / 2, 0)
      .rotateZ(angle)
      .rotateY(yaw)
      .translate(0, height, 0)
    parts.push(paint(branch, birch ? TREE.twig : trunkColor))
  }
  return merge(parts)
}

/**
 * 矢羽根（北海道の固定式視線誘導柱）。支柱から腕が +X（道の方）へ伸び、赤白の下向きの矢印が路肩の真上に下がる。
 * 原点は支柱の根元（中心線から ARROW_D_M）
 */
export function buildArrowPost(): BufferGeometry {
  const reach = ARROW_D_M - LANE_EDGE_M - 0.4
  const parts: BufferGeometry[] = [
    paint(new CylinderGeometry(0.06, 0.07, 5.6, 5, 1, true).translate(0, 2.8, 0), TERRAIN.pole),
    paint(new BoxGeometry(reach, 0.08, 0.08).translate(reach / 2, 5.5, 0), TERRAIN.pole),
  ]
  // 赤白の縞（5 段）と下向きの先
  const top = 5.4
  const stripe = 0.24
  for (let i = 0; i < 5; i++) {
    const color = i % 2 === 0 ? TERRAIN.arrowRed : TERRAIN.arrowWhite
    parts.push(
      paint(
        new BoxGeometry(0.42, stripe, 0.04).translate(reach, top - stripe * (i + 0.5), 0),
        color,
      ),
    )
  }
  const tip = new ConeGeometry(0.3, 0.4, 3, 1)
    .rotateZ(Math.PI)
    .translate(reach, top - stripe * 5 - 0.2, 0)
  parts.push(paint(tip, TERRAIN.arrowRed))
  return merge(parts)
}
