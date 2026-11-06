import ReactThreeTestRenderer from '@react-three/test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { Color, type LineSegments, type Mesh, type MeshLambertMaterial, type Points } from 'three'
import type { Deer, Surface, Weather, World } from '../types'
import type { SceneSeason } from '../domain/season'
import { PRECIP_LAYER } from './layout'
import { SEASON } from './palette'
import { demoScenario } from '../domain/scenario'
import { createWorld } from '../domain/simulation'
import { ZONES } from '../domain/zones-data'
import { DriveScene } from './DriveScene'

// R12・UC-5e の smoke test: jsdom では WebGL が動かないので、@react-three/test-renderer で
// シーンが落ちずに組み立つこと、鹿の数がメッシュに出ること、onFrame が毎フレーム呼ばれることだけを見る。

function deer(id: string, s: number, d: number, over: Partial<Deer> = {}): Deer {
  return {
    id,
    candidateId: id.split('-').slice(0, 2).join('-'),
    pattern: 'roadside',
    index: 0,
    s,
    d,
    heading: Math.PI,
    pose: 'look',
    occluded: false,
    startedAt: null,
    gone: false,
    ...over,
  }
}

async function frames(
  renderer: Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>,
  n: number,
) {
  for (let i = 0; i < n; i++) {
    await ReactThreeTestRenderer.act(async () => {
      await renderer.advanceFrames(1, 1 / 60)
    })
  }
}

function countDeer(renderer: Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>): number {
  return renderer.scene.findAll((node) => node.instance.name === 'deer').length
}

describe('DriveScene の季節と天気（drive-season R3・R6）', () => {
  const cases: {
    name: string
    startAt: string
    surface: Surface
    weather: Weather
    season: SceneSeason
    falling: 'Points' | 'LineSegments' | null
  }[] = [
    {
      name: '冬・雪',
      startAt: '2027-02-15T16:40:00+09:00',
      surface: 'packed-snow',
      weather: 'snow',
      season: 'winter',
      falling: 'Points',
    },
    {
      name: '雪どけ・雨',
      startAt: '2027-04-15T16:40:00+09:00',
      surface: 'wet',
      weather: 'rain',
      season: 'thaw',
      falling: 'LineSegments',
    },
    {
      name: '夏・晴れ',
      startAt: '2027-07-15T16:40:00+09:00',
      surface: 'dry',
      weather: 'clear',
      season: 'green',
      falling: null,
    },
    {
      name: '秋・霧',
      startAt: '2027-10-15T16:40:00+09:00',
      surface: 'dry',
      weather: 'fog',
      season: 'autumn',
      falling: null,
    },
  ]

  for (const c of cases) {
    it(`UC-3b・UC-3d・UC-3e: ${c.name} は季節の地面、林の描画コール 4、降るもの ${c.falling ?? 'なし'}`, async () => {
      const scenario = {
        ...demoScenario(ZONES),
        startAt: c.startAt,
        surface: c.surface,
        weather: c.weather,
      }
      const world: World = createWorld(scenario, ZONES)
      world.vehicle.s = 2000
      const renderer = await ReactThreeTestRenderer.create(
        <DriveScene world={() => world} phone={null} onFrame={() => {}} />,
      )
      await frames(renderer, 2)
      // 名前の付いた Object3D だけ（fog・color などは名前を持たない）
      const all = renderer.scene.findAll((n) => typeof n.instance.name === 'string')
      // 林は種類ごとに InstancedMesh 1 つ（季節によらず 4 つ）
      const forest = all.filter((n) => n.instance.name.startsWith('forest-'))
      expect(forest).toHaveLength(4)
      // 地面は季節の色
      const ground = all.find((n) => n.instance.name === 'ground')?.instance as Mesh | undefined
      const color = (ground?.material as MeshLambertMaterial | undefined)?.color
      expect(color?.getHexString()).toBe(new Color(SEASON[c.season].ground).getHexString())
      // 降るもの: 1 つ（1 描画コール）か、無い
      const falling = all.filter((n) => n.instance.name.startsWith('precipitation-'))
      expect(falling).toHaveLength(c.falling ? 1 : 0)
      if (c.falling) {
        const obj = falling[0]?.instance as Points | LineSegments
        expect(obj.type).toBe(c.falling)
        // 降るものはミラーに映らないレイヤーだけにある
        expect(obj.layers.isEnabled(PRECIP_LAYER)).toBe(true)
        expect(obj.layers.isEnabled(0)).toBe(false)
      }
      await renderer.unmount()
    })
  }
})

describe('DriveScene（R12、smoke）', () => {
  it('UC-5e: シーンが組み立ち、onFrame が毎フレーム先に呼ばれ、鹿の数がメッシュに出る', async () => {
    const world: World = createWorld(demoScenario(ZONES), ZONES)
    world.vehicle.s = 2000
    const onFrame = vi.fn()
    const renderer = await ReactThreeTestRenderer.create(
      <DriveScene world={() => world} phone={null} onFrame={onFrame} />,
    )
    await frames(renderer, 2)
    expect(onFrame).toHaveBeenCalled()
    expect(onFrame.mock.calls[0]?.[0]).toBeCloseTo(1000 / 60, 5)
    expect(countDeer(renderer)).toBe(0)
    // 道路・林・車内ができている
    const names = renderer.scene
      .findAll((node) => node.instance.name !== '')
      .map((node) => node.instance.name)
    expect(names).toContain('cabin')
    expect(names).toContain('forest-conifer')

    // 鹿が 3 頭（群れ）出て、1 頭は去った
    world.deer = [
      deer('d0-1-0', 2080, -5.5, { pattern: 'herd', pose: 'walk', heading: Math.PI / 2 }),
      deer('d0-1-1', 2080, -7.6, { pattern: 'herd', index: 1 }),
      deer('d0-1-2', 2080, -9.7, { pattern: 'herd', index: 2, occluded: true }),
      deer('d0-2-0', 2300, 6, { gone: true }),
    ]
    await frames(renderer, 2)
    expect(countDeer(renderer)).toBe(3)

    // 去ると消える
    world.deer = world.deer.slice(0, 1)
    await frames(renderer, 2)
    expect(countDeer(renderer)).toBe(1)
    await renderer.unmount()
  })

  it('smoke: スマホの中身（phone）を渡しても落ちない（Html は車内のスマホの板に付く）', async () => {
    const world: World = createWorld(demoScenario(ZONES), ZONES)
    const renderer = await ReactThreeTestRenderer.create(
      <DriveScene world={() => world} phone={<div>phone</div>} onFrame={() => {}} />,
    )
    await frames(renderer, 2)
    expect(renderer.scene.findAll((node) => node.instance.name === 'cabin')).toHaveLength(1)
    await renderer.unmount()
  })

  it('UC-5f: 車の前で車の方を向く鹿は目が光り（光の板が見える）、背を向けると消える', async () => {
    const world: World = createWorld(demoScenario(ZONES), ZONES)
    world.vehicle.s = 2000
    world.deer = [deer('d0-3-0', 2050, -1.75, { heading: Math.PI, pose: 'idle' })]
    const renderer = await ReactThreeTestRenderer.create(
      <DriveScene world={() => world} phone={null} onFrame={() => {}} />,
    )
    await frames(renderer, 2)
    // 鹿の頭（deer の中の group）に付いた光の板
    const sprite = () =>
      renderer.scene.findAll(
        (node) => node.type === 'Sprite' && node.instance.parent?.parent?.name === 'deer',
      )[0]?.instance
    expect(sprite()?.visible).toBe(true)
    world.deer = [{ ...(world.deer[0] as Deer), heading: 0 }]
    await frames(renderer, 1)
    expect(sprite()?.visible).toBe(false)
    await renderer.unmount()
  })
})
