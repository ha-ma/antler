import {
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RingGeometry,
  type BufferGeometry,
  type DataTexture,
} from 'three'
import { deriveSeed } from '../domain/rng'
import { DEER } from './palette'
import { blobTexture, merge, mix, paint, smoothstep } from './mesh-utils'

// 自作のローポリのエゾシカ（ch9 ③ は仮採用 c＋d。決まるまでの代わり）。
// 体長 約 1.6 m（鼻先から尾）・幅 0.5 m・肩高 約 1.0 m。冬毛の灰褐色、臀に黒く縁取った白斑。
// 座標: 原点は 4 本の脚の真ん中の地面、-Z が前、+Y が上。脚と頭は別の形にして、DeerModel が回して動かす。

/** 脚の付け根（肩・腰）の高さと位置 */
export const LEG_PIVOT_Y = 0.64
export const LEGS: readonly (readonly [x: number, z: number])[] = [
  [-0.11, -0.36],
  [0.11, -0.36],
  [-0.11, 0.36],
  [0.11, 0.36],
]
/** 首の付け根（頭の形の原点） */
export const NECK_PIVOT: readonly [number, number, number] = [0, 0.94, -0.44]
/** 首の付け根から見た目の位置（目の反射の光を置く） */
export const EYES_FROM_NECK: readonly [number, number, number] = [0, 0.41, -0.43]

/** 胴・臀の白斑・尾 */
export function buildDeerBody(): BufferGeometry {
  // 腹は明るく、背は濃く
  const back = new Color(DEER.coatDark)
  const coat = (_x: number, y: number) =>
    mix(DEER.belly, DEER.coat, smoothstep(0.6, 0.78, y)).lerp(back, smoothstep(0.95, 1.05, y) * 0.6)
  const parts: BufferGeometry[] = [
    // 胴（7 角の筒を前後に寝かせ、上下に少し伸ばす）
    paint(
      new CylinderGeometry(0.21, 0.22, 0.86, 7, 1, true)
        .rotateX(Math.PI / 2)
        .scale(0.95, 1.18, 1)
        .translate(0, 0.8, 0),
      coat,
    ),
    // 胸と尻の丸み
    paint(new IcosahedronGeometry(0.235, 0).scale(0.95, 1.12, 1).translate(0, 0.82, -0.42), coat),
    paint(new IcosahedronGeometry(0.235, 0).scale(0.95, 1.08, 1).translate(0, 0.82, 0.42), coat),
    // 臀の白斑（黒い縁どり）と短い尾
    paint(new RingGeometry(0.135, 0.17, 10).translate(0, 0.8, 0.645), DEER.rumpRim),
    paint(new CircleGeometry(0.135, 10).translate(0, 0.8, 0.65), DEER.rumpWhite),
    paint(
      new ConeGeometry(0.04, 0.15, 4).rotateX(Math.PI).translate(0, 0.86, 0.67),
      DEER.rumpWhite,
    ),
  ]
  return merge(parts)
}

/** 首・頭・耳（buck は角つき。2 月の雄は角が残っている） */
export function buildDeerHead(buck: boolean): BufferGeometry {
  const parts: BufferGeometry[] = [
    // 首（付け根から前上へ）
    paint(
      new CylinderGeometry(0.075, 0.12, 0.46, 6, 1, true).translate(0, 0.23, 0).rotateX(-0.62),
      DEER.coat,
    ),
    // 頭（後頭部の丸みと、前へ細くなる鼻面）
    paint(new IcosahedronGeometry(0.1, 0).scale(0.9, 1, 1.1).translate(0, 0.38, -0.3), DEER.coat),
    paint(
      new ConeGeometry(0.075, 0.26, 5).rotateX(-Math.PI / 2).translate(0, 0.35, -0.47),
      DEER.coatDark,
    ),
    paint(new IcosahedronGeometry(0.028, 0).translate(0, 0.35, -0.6), DEER.nose),
    // 耳
    paint(new ConeGeometry(0.04, 0.14, 4).rotateZ(1.15).translate(-0.12, 0.45, -0.26), DEER.coat),
    paint(new ConeGeometry(0.04, 0.14, 4).rotateZ(-1.15).translate(0.12, 0.45, -0.26), DEER.coat),
  ]
  if (buck) {
    for (const side of [-1, 1] as const) {
      // 主軸と 3 本の枝（エゾシカの角は 4 尖）
      parts.push(
        paint(
          new CylinderGeometry(0.012, 0.025, 0.5, 4)
            .translate(0, 0.25, 0)
            .rotateZ(-side * 0.45)
            .rotateX(0.35)
            .translate(side * 0.06, 0.45, -0.24),
          DEER.antler,
        ),
      )
      for (const [h, lean] of [
        [0.16, 0.9],
        [0.3, 0.7],
        [0.42, 1.1],
      ] as const) {
        parts.push(
          paint(
            new CylinderGeometry(0.008, 0.015, 0.18, 3)
              .translate(0, 0.09, 0)
              .rotateX(-lean)
              .translate(side * (0.06 + h * 0.43), 0.45 + h * 0.85, -0.24 - h * 0.25),
            DEER.antler,
          ),
        )
      }
    }
  }
  return merge(parts)
}

/** 鹿の全頭で共有する形・材質・テクスチャ（1 回だけ作る） */
export type DeerAssets = {
  body: BufferGeometry
  headDoe: BufferGeometry
  headBuck: BufferGeometry
  leg: BufferGeometry
  /** 鹿の PBR の材質（頂点色、毛なので粗い） */
  coat: MeshStandardMaterial
  /** 目の反射の光（2 点のぼかし、横長 2:1） */
  eyeshine: DataTexture
  blob: BufferGeometry
  blobMaterial: MeshBasicMaterial
}

export function createDeerAssets(): DeerAssets {
  return {
    body: buildDeerBody(),
    headDoe: buildDeerHead(false),
    headBuck: buildDeerHead(true),
    leg: buildDeerLeg(),
    coat: new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0,
      flatShading: true,
    }),
    eyeshine: blobTexture(
      64,
      32,
      [
        [21, 16],
        [43, 16],
      ],
      10,
    ),
    blob: new PlaneGeometry(0.9, 1.9).rotateX(-Math.PI / 2),
    blobMaterial: new MeshBasicMaterial({
      map: blobTexture(32, 32, [[16, 16]], 16),
      color: DEER.blob,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    }),
  }
}

/** id から決まる個体差（角のある雄か、歩く脚の位相）。乱数でなく id のハッシュ（同じシードで同じ見た目） */
export function deerLooks(id: string): { buck: boolean; phase: number } {
  const h = deriveSeed(0x5eed, id)
  return { buck: h % 10 < 4, phase: ((h >>> 8) / 0x1000000) * Math.PI * 2 }
}

/** 脚 1 本（原点は付け根、-Y へ伸びる。先に蹄） */
export function buildDeerLeg(): BufferGeometry {
  return merge([
    paint(
      new CylinderGeometry(0.05, 0.026, LEG_PIVOT_Y - 0.05, 5, 1, true).translate(
        0,
        -(LEG_PIVOT_Y - 0.05) / 2,
        0,
      ),
      DEER.coatDark,
    ),
    paint(
      new CylinderGeometry(0.026, 0.032, 0.05, 5).translate(0, -LEG_PIVOT_Y + 0.025, 0),
      DEER.hoof,
    ),
  ])
}
