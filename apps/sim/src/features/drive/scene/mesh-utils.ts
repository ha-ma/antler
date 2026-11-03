import {
  BufferGeometry,
  Color,
  DataTexture,
  Float32BufferAttribute,
  LinearFilter,
  RGBAFormat,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// ローポリの形をコードで作るための小道具（外部ファイルを読まない。R12）。
// 頂点色で塗って 1 つの形にまとめ、描画コールを減らす。

/** 頂点の高さ y → 色 */
export type Paint = string | ((x: number, y: number, z: number) => Color)

/** 頂点色をつけ、index を外して（形の種類をそろえて）返す */
export function paint(geo: BufferGeometry, color: Paint): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo
  g.deleteAttribute('uv')
  const pos = g.getAttribute('position')
  const colors = new Float32Array(pos.count * 3)
  const flat = typeof color === 'string' ? new Color(color) : null
  for (let i = 0; i < pos.count; i++) {
    const c = flat ?? (color as Exclude<Paint, string>)(pos.getX(i), pos.getY(i), pos.getZ(i))
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3))
  return g
}

/** 塗った形を 1 つにまとめる（法線は面ごとに作り直す。フラットシェーディング） */
export function merge(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts, false)
  if (!merged) throw new Error('形をまとめられません（属性がそろっていない）')
  merged.computeVertexNormals()
  merged.computeBoundingSphere()
  for (const p of parts) p.dispose()
  return merged
}

/** a と b を t（0〜1）で混ぜた色 */
export function mix(a: string, b: string, t: number): Color {
  return new Color(a).lerp(new Color(b), Math.min(1, Math.max(0, t)))
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/**
 * 丸いぼかしの点を並べたテクスチャ（白、アルファで形）。目の反射（2 点）と足元の影（1 点）に使う。
 * canvas を使わないので jsdom でも作れる
 */
export function blobTexture(
  width: number,
  height: number,
  centers: [number, number][],
  radius: number,
): DataTexture {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let a = 0
      for (const [cx, cy] of centers) {
        const r = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius
        a = Math.max(a, Math.max(0, 1 - r) ** 2)
      }
      const i = (y * width + x) * 4
      data[i] = 255
      data[i + 1] = 255
      data[i + 2] = 255
      data[i + 3] = Math.round(a * 255)
    }
  }
  const tex = new DataTexture(data, width, height, RGBAFormat)
  tex.magFilter = LinearFilter
  tex.minFilter = LinearFilter
  tex.needsUpdate = true
  return tex
}
