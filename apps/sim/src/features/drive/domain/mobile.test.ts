import { describe, expect, it, vi } from 'vitest'
import { NO_INPUT, type DriveInput } from '../types'
import { deviceDirection, GyroLook, GYRO_STALE_MS } from './gyro-look'
import { InputMixer } from './input-mix'
import { LookInput } from './look-input'
import { stickInput, stickOffset } from './touch-stick'

// docs/specs/mobile-landscape/functional.md R3・R4 の純粋な部分

describe('左の円（R3）', () => {
  it('ML-3a: ずれ → 入力（遊び 0.3。上で加速、下で減速・後退、左右でステア、斜めは 2 つ同時）', () => {
    expect(stickInput(0, 0)).toEqual({ left: false, right: false, throttle: false, back: false })
    // 遊びの中
    expect(stickInput(0.29, -0.29)).toEqual({
      left: false,
      right: false,
      throttle: false,
      back: false,
    })
    expect(stickInput(0, -0.5)).toMatchObject({ throttle: true, back: false })
    expect(stickInput(0, 0.5)).toMatchObject({ throttle: false, back: true })
    expect(stickInput(-0.5, 0)).toMatchObject({ left: true, right: false })
    expect(stickInput(0.5, 0)).toMatchObject({ left: false, right: true })
    expect(stickInput(0.6, -0.6)).toEqual({ left: false, right: true, throttle: true, back: false })
  })

  it('ML-3a: 指の位置 → 円の中のずれ（半径で割る。円の外は縁に丸める）', () => {
    // 中心 (100, 100)、半径 60
    expect(stickOffset(100, 100, 100, 100, 60)).toEqual({ x: 0, y: 0 })
    expect(stickOffset(130, 100, 100, 100, 60)).toEqual({ x: 0.5, y: 0 })
    const far = stickOffset(100, 400, 100, 100, 60)
    expect(far.x).toBeCloseTo(0)
    expect(far.y).toBeCloseTo(1)
    const diag = stickOffset(300, 300, 100, 100, 60)
    expect(Math.hypot(diag.x, diag.y)).toBeCloseTo(1)
    // 半径 0 でも NaN にしない
    expect(stickOffset(10, 10, 0, 0, 0)).toEqual({ x: 0, y: 0 })
  })
})

describe('キーと指の入力を合わせる（R3）', () => {
  it('ML-3d: どちらかが押していれば押している。指を離してもキーの押下は残る', () => {
    const setInput = vi.fn<(input: DriveInput) => void>()
    const mixer = new InputMixer({ setInput })
    const keys = mixer.source('keys')
    const touch = mixer.source('touch')
    keys.setInput({ ...NO_INPUT, throttle: true })
    expect(setInput).toHaveBeenLastCalledWith({ ...NO_INPUT, throttle: true })
    touch.setInput({ ...NO_INPUT, brake: true, left: true })
    expect(setInput).toHaveBeenLastCalledWith({
      ...NO_INPUT,
      throttle: true,
      brake: true,
      left: true,
    })
    touch.setInput({ ...NO_INPUT })
    expect(setInput).toHaveBeenLastCalledWith({ ...NO_INPUT, throttle: true })
    keys.setInput({ ...NO_INPUT })
    expect(setInput).toHaveBeenLastCalledWith({ ...NO_INPUT })
  })
})

describe('端末の向き → 背面の方角と仰角（R4）', () => {
  it('ML-4a: 縦持ちで背面を水平・北に向けると方角 0・仰角 0。右（時計回り）に回すと方角が増える', () => {
    // 縦持ち・直立: beta 90
    const d = deviceDirection(0, 90, 0)
    expect(d.elevationDeg).toBeCloseTo(0)
    expect(d.headingDeg).toBeCloseTo(0)
    // alpha は反時計回りが正（W3C）。右に 10° 回すと alpha = 350
    expect(deviceDirection(350, 90, 0).headingDeg).toBeCloseTo(10)
    // 上の縁を手前に倒すと背面が上を向く（beta 100 → 上へ 10°）。画面を上にして寝かせると真下（-90°）
    expect(deviceDirection(0, 100, 0).elevationDeg).toBeCloseTo(10)
    expect(deviceDirection(0, 80, 0).elevationDeg).toBeCloseTo(-10)
    expect(deviceDirection(0, 0, 0).elevationDeg).toBeCloseTo(-90)
  })

  it('ML-4a: 横持ち（gamma ±90）でも背面を水平に向けると仰角 0。右に回すと方角が増える', () => {
    const a = deviceDirection(0, 0, -90)
    const b = deviceDirection(350, 0, -90)
    expect(a.elevationDeg).toBeCloseTo(0)
    expect(wrapDeg(b.headingDeg - a.headingDeg)).toBeCloseTo(10)
    const c = deviceDirection(0, 0, 90)
    const e = deviceDirection(350, 0, 90)
    expect(c.elevationDeg).toBeCloseTo(0)
    expect(wrapDeg(e.headingDeg - c.headingDeg)).toBeCloseTo(10)
  })
})

function wrapDeg(d: number): number {
  return ((((d + 180) % 360) + 360) % 360) - 180
}

describe('ジャイロの視線（R4）', () => {
  const sample = (headingDeg: number, elevationDeg: number) => ({ headingDeg, elevationDeg })

  it('ML-4b: 基準からのずれ → 目標（12° で右いっぱい、6° で上いっぱい。境目 360° をまたぐ）', () => {
    const g = new GyroLook()
    g.push(sample(355, 0), 0)
    expect(g.target(0)).toEqual({ x: 0, y: 0 })
    g.push(sample(1, 3), 0)
    const t = g.target(0)
    expect(t?.x).toBeCloseTo(0.5)
    expect(t?.y).toBeCloseTo(0.5)
    g.push(sample(30, -20), 0)
    expect(g.target(0)).toEqual({ x: 1, y: -1 })
    g.push(sample(320, 0), 0)
    expect(g.target(0)?.x).toBe(-1)
  })

  it('ML-4c: 基準は時定数 5 秒でいまの向きに寄る', () => {
    const g = new GyroLook()
    g.push(sample(0, 0), 0)
    g.push(sample(6, 0), 0)
    expect(g.target(0)?.x).toBeCloseTo(0.5)
    // 5 秒同じ向きで持つと、ずれは 1/e に縮む
    for (let t = 100; t <= 5000; t += 100) g.push(sample(6, 0), t)
    expect(g.target(5000)?.x).toBeCloseTo(0.5 * Math.exp(-1), 2)
  })

  it('ML-4c: 仰角が 70° を超えると方角のずれは前の値のまま', () => {
    const g = new GyroLook()
    g.push(sample(0, 0), 0)
    g.push(sample(6, 0), 0)
    g.push(sample(90, 75), 0)
    const t = g.target(0)
    expect(t?.x).toBeCloseTo(0.5)
    expect(t?.y).toBe(1)
  })

  it('ML-4e: 1 秒届かないと null（ポインタに戻る）。clear で基準も捨てる', () => {
    const g = new GyroLook()
    expect(g.target(0)).toBeNull()
    g.push(sample(10, 0), 1000)
    expect(g.target(1000 + GYRO_STALE_MS - 1)).not.toBeNull()
    expect(g.target(1000 + GYRO_STALE_MS + 1)).toBeNull()
    g.clear()
    expect(g.target(1000)).toBeNull()
    // 次に届いた向きが新しい基準
    g.push(sample(40, 0), 2000)
    expect(g.target(2000)).toEqual({ x: 0, y: 0 })
  })

  it('ML-4e: 向きが届けばジャイロ、届かなければ指のドラッグ（離すと 0）かマウスのカーソル', () => {
    const look = new LookInput()
    const cursor = { x: 0.4, y: -0.2 }
    // 何も触っていなければカーソル（マウス）
    expect(look.target(cursor, 0)).toEqual(cursor)
    look.dragTo(0.5, 2)
    expect(look.target(cursor, 0)).toEqual({ x: 0.5, y: 1 })
    look.release()
    expect(look.target(cursor, 0)).toEqual({ x: 0, y: 0 })
    // マウスを動かしたらカーソルに戻る
    look.mouse()
    expect(look.target(cursor, 0)).toEqual(cursor)
    // ジャイロが届いている間はジャイロ
    look.gyro.push(sample(0, 0), 0)
    look.gyro.push(sample(12, 0), 100)
    expect(look.target(cursor, 100).x).toBeGreaterThan(0.9)
    // 途切れたらカーソル
    expect(look.target(cursor, 100 + GYRO_STALE_MS + 1)).toEqual(cursor)
    look.reset()
    expect(look.target(cursor, 100)).toEqual(cursor)
  })
})
