import { describe, expect, it } from 'vitest'
import type { Dashboard } from '../domain/dashboard'
import { dashboardKey, formatDashboard } from './dashboard-text'
import { CLUSTER_PX, CLUSTER_SIZE_M, paintCluster, type Painter2D } from './dashboard-paint'

// ダッシュボードの文字（drive-tune R5・UC-4b〜UC-4d）。dashboardOf の値 → 画面の文字は純粋関数で決める。

const BASE: Dashboard = {
  speedKmh: 63.4,
  rpm: 2100,
  gear: 3,
  // 2027-02-10 18:42 JST（= 09:42 UTC）
  clockMs: Date.UTC(2027, 1, 10, 9, 42, 30),
  outsideTempC: -4,
  abs: false,
  brake: 0,
  nav: { kind: 'zone-ahead', km: 2.43 },
}

/** fillText の引数を記録するだけの 2D の文脈 */
function recorder(): Painter2D & { texts: string[]; fills: string[] } {
  const texts: string[] = []
  const fills: string[] = []
  const ctx = {
    texts,
    fills,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    clearRect() {},
    fillRect() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    stroke() {},
    fill() {
      fills.push(String(ctx.fillStyle))
    },
    roundRect() {},
    fillText(text: string) {
      texts.push(text)
    },
    measureText(text: string) {
      return { width: text.length * 10 } as TextMetrics
    },
  }
  return ctx
}

describe('formatDashboard（drive-tune R5）', () => {
  it('UC-4b: ギアは D と段（後退は R）、速さは整数の km/h', () => {
    expect(formatDashboard(BASE).gear).toBe('D3')
    expect(formatDashboard({ ...BASE, gear: 1 }).gear).toBe('D1')
    expect(formatDashboard({ ...BASE, gear: 'R' }).gear).toBe('R')
    expect(formatDashboard(BASE).speed).toBe('63')
    expect(formatDashboard({ ...BASE, speedKmh: 0.2 }).speed).toBe('0')
  })

  it('時計は JST の hh:mm（端末のタイムゾーンに左右されない）', () => {
    expect(formatDashboard(BASE).clock).toBe('18:42')
    // 0 時をまたぐ: 15:05 UTC = 翌 00:05 JST
    expect(formatDashboard({ ...BASE, clockMs: Date.UTC(2027, 1, 10, 15, 5) }).clock).toBe('00:05')
  })

  it('UC-4c: 外気温は °C（負はマイナス記号）', () => {
    expect(formatDashboard(BASE).temp).toBe('−4°C')
    expect(formatDashboard({ ...BASE, outsideTempC: 12 }).temp).toBe('12°C')
    expect(formatDashboard({ ...BASE, outsideTempC: 0 }).temp).toBe('0°C')
  })

  it('UC-4d: ナビの次の案内（ゾーンの外・中・最後のゾーンの後）', () => {
    expect(formatDashboard(BASE).nav).toBe('2.4 km 先 鹿ゾーン')
    expect(formatDashboard({ ...BASE, nav: { kind: 'in-zone', km: 0.86 } }).nav).toBe(
      '鹿ゾーン 残り 0.9 km',
    )
    expect(formatDashboard({ ...BASE, nav: { kind: 'destination', km: 23.6 } }).nav).toBe(
      '目的地まで 24 km',
    )
    // 10 km 未満は小数 1 桁、負にならない
    expect(formatDashboard({ ...BASE, nav: { kind: 'destination', km: -0.01 } }).nav).toBe(
      '目的地まで 0.0 km',
    )
  })

  it('ABS は灯の点灯だけ（文字は ABS）', () => {
    expect(formatDashboard(BASE).abs).toBe(false)
    expect(formatDashboard({ ...BASE, abs: true }).abs).toBe(true)
  })

  it('描き直しの鍵は表示が変わるときだけ変わる（回転数とブレーキは針・灯なので鍵に入れない）', () => {
    const key = dashboardKey(formatDashboard(BASE))
    expect(dashboardKey(formatDashboard({ ...BASE, rpm: 2900, brake: 0.7, speedKmh: 63.1 }))).toBe(
      key,
    )
    expect(dashboardKey(formatDashboard({ ...BASE, speedKmh: 64 }))).not.toBe(key)
    expect(dashboardKey(formatDashboard({ ...BASE, abs: true }))).not.toBe(key)
    expect(dashboardKey(formatDashboard({ ...BASE, clockMs: BASE.clockMs + 60_000 }))).not.toBe(key)
  })
})

describe('paintCluster（canvas に描く文字）', () => {
  it('UC-4b・UC-4d: dashboardOf の値が文字盤の文字に出る', () => {
    const ctx = recorder()
    paintCluster(ctx, formatDashboard(BASE))
    for (const text of ['63', 'km/h', 'D3', '18:42', '−4°C', 'ABS', '2.4 km 先 鹿ゾーン'])
      expect(ctx.texts).toContain(text)
    // 目盛りの数字（速度 0〜120、回転 0〜6）
    expect(ctx.texts).toContain('120')
    expect(ctx.texts).toContain('6')
  })

  it('ABS の灯は abs のときだけ点ける色で塗る（alert-danger は使わない）', () => {
    const off = recorder()
    paintCluster(off, formatDashboard(BASE))
    const on = recorder()
    paintCluster(on, formatDashboard({ ...BASE, abs: true }))
    expect(on.fills).not.toEqual(off.fills)
    for (const fill of [...on.fills, ...off.fills]) {
      expect(fill.toUpperCase()).not.toBe('#D83B1E')
      expect(fill.toUpperCase()).not.toBe('#E2492C')
    }
  })

  it('canvas の大きさは文字盤の板の縦横比に合う', () => {
    expect(CLUSTER_PX[0] / CLUSTER_PX[1]).toBeCloseTo(CLUSTER_SIZE_M[0] / CLUSTER_SIZE_M[1], 2)
  })
})
