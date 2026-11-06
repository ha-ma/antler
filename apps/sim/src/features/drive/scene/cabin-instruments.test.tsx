import ReactThreeTestRenderer from '@react-three/test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mesh, MeshBasicMaterial } from 'three'
import type { World } from '../types'
import { dashboardOf } from '../domain/dashboard'
import { demoScenario } from '../domain/scenario'
import { createWorld } from '../domain/simulation'
import { ZONES } from '../domain/zones-data'
import { DriveScene } from './DriveScene'
import { formatDashboard } from './dashboard-text'
import { speedAngle } from './dashboard-paint'

// drive-tune R5 の smoke: ミラーとダッシュボードが組み立ち、dashboardOf の値が文字盤の文字に出る。
// jsdom の canvas は 2D の文脈を返さないので、fillText を記録するだけの文脈に差し替える。

type Renderer = Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>

async function frames(renderer: Renderer, n: number) {
  for (let i = 0; i < n; i++) {
    await ReactThreeTestRenderer.act(async () => {
      await renderer.advanceFrames(1, 1 / 60)
    })
  }
}

function recordingContext() {
  const texts: string[] = []
  const noop = () => {}
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    clearRect: noop,
    fillRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    stroke: noop,
    fill: noop,
    roundRect: noop,
    fillText: (text: string) => texts.push(text),
    measureText: (text: string) => ({ width: text.length * 10 }),
  }
  return { ctx, texts }
}

function byName(renderer: Renderer, name: string) {
  return renderer.scene.findAll((node) => node.instance.name === name)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('車内の計器とミラー（drive-tune R5、smoke）', () => {
  it('UC-4b・UC-4d: ダッシュボードの文字盤に速さ・ギア・時計・気温・ABS・ナビの案内が出て、針が速さを指す', async () => {
    const { ctx, texts } = recordingContext()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      ctx as unknown as CanvasRenderingContext2D,
    )
    const world: World = createWorld(demoScenario(ZONES), ZONES)
    world.vehicle.s = 2000
    world.vehicle.speed = 63.4 / 3.6
    world.vehicle.abs = true
    world.powertrain = { gear: 3, rpm: 2100 }
    const renderer = await ReactThreeTestRenderer.create(
      <DriveScene world={() => world} phone={null} onFrame={() => {}} />,
    )
    await frames(renderer, 2)

    expect(byName(renderer, 'dashboard')).toHaveLength(1)
    const expected = formatDashboard(dashboardOf(world))
    for (const text of ['63', 'D3', 'ABS', expected.clock, expected.temp, expected.nav])
      expect(texts).toContain(text)
    expect(expected.nav).toMatch(/鹿ゾーン|目的地まで/)

    const needle = byName(renderer, 'speed-needle')[0]?.instance as Mesh | undefined
    expect(needle?.rotation.z).toBeCloseTo(speedAngle(63.4), 5)

    // 後退は R
    texts.length = 0
    world.vehicle.speed = -2
    world.powertrain = { gear: 'R', rpm: 800 }
    await frames(renderer, 8)
    expect(texts).toContain('R')
    await renderer.unmount()
  })

  it('ミラーは後ろ向きのカメラの映像（描画先のテクスチャ）を左右反転して貼る', async () => {
    const world: World = createWorld(demoScenario(ZONES), ZONES)
    const renderer = await ReactThreeTestRenderer.create(
      <DriveScene world={() => world} phone={null} onFrame={() => {}} />,
    )
    await frames(renderer, 3)
    const mirror = byName(renderer, 'rear-mirror')[0]?.instance as Mesh | undefined
    expect((mirror?.material as MeshBasicMaterial | undefined)?.map).toBeTruthy()
    // 左右反転: 運転者から見て左の頂点ほど u が大きい（PlaneGeometry の 0 番は左上）
    const uv = mirror?.geometry.getAttribute('uv')
    expect(uv?.getX(0)).toBe(1)
    expect(uv?.getX(1)).toBe(0)
    // カメラは車内（cabin）に付いて動く
    const camera = byName(renderer, 'rear-mirror-camera')[0]?.instance
    expect(camera?.parent?.name).toBe('cabin')
    await renderer.unmount()
  })
})
