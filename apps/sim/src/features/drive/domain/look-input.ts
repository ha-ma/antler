import { GyroLook } from './gyro-look'

// 視線の入力元を 1 つにまとめる（docs/specs/mobile-landscape/functional.md R4）。
// ジャイロの向きが届いていればジャイロ、届かなければ、最後に運転画面を触ったのが指なら指のドラッグ
// （離したら 0）、マウスならカーソルの位置（R3F の pointer）。返すのは look.ts の lookTarget に渡す -1〜1。
// 60 fps で読むので React の state にしない（シーンは useFrame の中で target を読む）。

type Point = { x: number; y: number }

const CENTER: Point = { x: 0, y: 0 }

export class LookInput {
  readonly gyro = new GyroLook()
  private drag: Point | null = null
  private touch = false

  /** 運転画面の上でマウスが動いた（カーソルの位置に戻す） */
  mouse(): void {
    this.touch = false
    this.drag = null
  }

  /** 指のドラッグの量（-1〜1。x: 右、y: 上） */
  dragTo(x: number, y: number): void {
    this.touch = true
    this.drag = { x: clampUnit(x), y: clampUnit(y) }
  }

  /** 指を離した（正面に戻す） */
  release(): void {
    this.drag = null
  }

  target(pointer: Point, nowMs: number): Point {
    const gyro = this.gyro.target(nowMs)
    if (gyro) return gyro
    if (this.touch) return this.drag ?? CENTER
    return pointer
  }

  /** 運転画面を離れたとき */
  reset(): void {
    this.gyro.clear()
    this.drag = null
    this.touch = false
  }
}

function clampUnit(v: number): number {
  if (Number.isNaN(v)) return 0
  return Math.min(1, Math.max(-1, v))
}

/** 運転画面の視線の入力（シーンの DriverCamera が読み、hooks/ が書く。運転画面は同時に 1 つだけ） */
export const driveLook = new LookInput()
