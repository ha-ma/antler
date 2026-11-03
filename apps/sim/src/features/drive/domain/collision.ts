// 衝突判定（R8、A5-6）。道の座標（s 前・d 右）の上で、車の箱（道の向き）と鹿の箱（体の向きに回す）を
// 分離軸で調べる。道の曲がりは鹿 1 頭の大きさでは無視できるので、平面にせず (s, d) のまま比べる。

export const CAR_LENGTH_M = 4.4
export const CAR_WIDTH_M = 1.7
export const DEER_LENGTH_M = 1.6
export const DEER_WIDTH_M = 0.5

export type Box = {
  /** 中心（s, d） */
  s: number
  d: number
  length: number
  width: number
  /** 道の向きからの角度（rad、正は右回り） */
  heading: number
}

export function carBox(s: number, d: number): Box {
  return { s, d, length: CAR_LENGTH_M, width: CAR_WIDTH_M, heading: 0 }
}

export function deerBox(s: number, d: number, heading: number): Box {
  return { s, d, length: DEER_LENGTH_M, width: DEER_WIDTH_M, heading }
}

/** 2 つの箱が重なるか（UC-8a） */
export function boxesOverlap(a: Box, b: Box): boolean {
  const axes = [...axesOf(a), ...axesOf(b)]
  return axes.every((axis) => {
    const [minA, maxA] = project(a, axis)
    const [minB, maxB] = project(b, axis)
    return maxA >= minB && maxB >= minA
  })
}

type Vec = [number, number]

/** 箱の 2 本の軸（前と右）。成分は (s, d) */
function axesOf(box: Box): [Vec, Vec] {
  const c = Math.cos(box.heading)
  const s = Math.sin(box.heading)
  return [
    [c, s],
    [-s, c],
  ]
}

function project(box: Box, axis: Vec): [number, number] {
  const [front, right] = axesOf(box)
  const center = box.s * axis[0] + box.d * axis[1]
  const half =
    (box.length / 2) * Math.abs(front[0] * axis[0] + front[1] * axis[1]) +
    (box.width / 2) * Math.abs(right[0] * axis[0] + right[1] * axis[1])
  return [center - half, center + half]
}
