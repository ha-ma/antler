import { deriveAlertState } from '@antler/alert-ui'
import { planRoute } from '@antler/zones'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { boxesOverlap, carBox, deerBox } from './collision'
import { formatJstTime, sunsetOf } from './clock'
import { summarizeFrames } from './frame-stats'
import { INITIAL_PLAYBACK, requestRate, scaledDt, setInZone, setPaused } from './playback'
import { createRoadFrame, lonLatAt } from './road'
import { demoScenario } from './scenario'
import { zoneStatusAt } from './zone-status'
import { ZONES } from './zones-data'

const scenario = demoScenario(ZONES)
const plan = planRoute(scenario.route, ZONES)
const frame = createRoadFrame(scenario.route)
const [first, second] = plan.intervals

describe('ゾーン状態（R2）', () => {
  it('UC-2a: 始点（外）の最初のフレームで outside と次の区間までの km。区間の中から始めると inside', () => {
    const start = zoneStatusAt(plan, lonLatAt(frame, 0, -1.75))
    expect(start.gps.status).toBe('outside')
    expect(start.gps.status === 'outside' && start.gps.distanceKm).toBeCloseTo(
      first?.entryKm ?? 0,
      1,
    )
    const inside = zoneStatusAt(plan, lonLatAt(frame, ((first?.entryKm ?? 0) + 1) * 1000, -1.75))
    expect(inside.gps.status).toBe('inside')
  })

  it('UC-2b: 入口を越えると inside と残り km、出口を越えると次の区間まで、最後の区間の後は距離なし', () => {
    const inFirst = zoneStatusAt(plan, lonLatAt(frame, ((first?.entryKm ?? 0) + 0.5) * 1000, -1.75))
    expect(inFirst.gps).toEqual({
      status: 'inside',
      remainingKm: expect.closeTo((first?.exitKm ?? 0) - (first?.entryKm ?? 0) - 0.5, 1) as number,
    })
    const between = zoneStatusAt(plan, lonLatAt(frame, ((first?.exitKm ?? 0) + 1) * 1000, -1.75))
    expect(between.gps.status).toBe('outside')
    expect(between.gps.status === 'outside' && between.gps.distanceKm).toBeCloseTo(
      (second?.entryKm ?? 0) - (first?.exitKm ?? 0) - 1,
      1,
    )
    const after = zoneStatusAt(plan, lonLatAt(frame, frame.lengthM - 10, -1.75))
    expect(after.gps).toEqual({ status: 'outside' })
    expect(after.nextEntryKm).toBeNull()
  })

  it('UC-2c: 最初のフレームのゾーン状態を deriveAlertState に渡すと safe', () => {
    const start = zoneStatusAt(plan, lonLatAt(frame, 0, -1.75))
    const alert = deriveAlertState({
      flag: null,
      flagReceivedAt: null,
      gps: start.gps,
      now: 0,
      previous: null,
    })
    expect(alert.state).toBe('safe')
  })
})

describe('再生速度（R4）', () => {
  it('UC-4c: ゾーン内で 4× / 16× は断られて 1× のまま。一時停止と再開はできる', () => {
    const locked = setInZone(requestRate(INITIAL_PLAYBACK, 16).playback, true)
    expect(locked.rate).toBe(1)
    expect(requestRate(locked, 4)).toEqual({ playback: locked, rejected: 'in-zone' })
    expect(requestRate(locked, 16).rejected).toBe('in-zone')
    const paused = setPaused(locked, true)
    expect(scaledDt(paused, 100)).toBe(0)
    expect(scaledDt(setPaused(paused, false), 100)).toBe(100)
  })

  it('UC-4d: ゾーンを出たあとは 1× のまま、4× / 16× に変えられる', () => {
    const out = setInZone(setInZone(INITIAL_PLAYBACK, true), false)
    expect(out).toEqual({ rate: 1, paused: false, locked: false })
    const fast = requestRate(out, 16)
    expect(fast.rejected).toBeNull()
    expect(scaledDt(fast.playback, 100)).toBe(1600)
  })
})

describe('衝突（R8）', () => {
  it('UC-8a: 車の箱と鹿の箱が重なると衝突、離れていれば衝突しない（鹿は体の向きに回す）', () => {
    const car = carBox(100, -1.75)
    // 車の前端は 102.2。横向きの鹿は道の向きに幅 0.5 m
    expect(boxesOverlap(car, deerBox(102.4, -1.75, Math.PI / 2))).toBe(true)
    expect(boxesOverlap(car, deerBox(102.5, -1.75, Math.PI / 2))).toBe(false)
    // 横向きなら長さ 1.6 m が道の横に広がる（車の右端は -0.9）。縦向きなら幅 0.5 m だけ
    expect(boxesOverlap(car, deerBox(100, -0.15, Math.PI / 2))).toBe(true)
    expect(boxesOverlap(car, deerBox(100, -0.15, 0))).toBe(false)
  })
})

describe('記録と時刻', () => {
  it('UC-9c: フレーム時間の列から fps の中央値と 5 パーセンタイル', () => {
    const frames = [...Array<number>(95).fill(1000 / 60), ...Array<number>(5).fill(1000 / 20)]
    const s = summarizeFrames(frames)
    expect(s?.fpsMedian).toBeCloseTo(60, 6)
    expect(s?.fpsP5).toBeLessThan(60)
    expect(s?.frames).toBe(100)
    expect(summarizeFrames([])).toBeNull()
  })

  it('UC-7f: 日没は JST で出す（釧路 2027-02-15 はおよそ 16:50〜17:00）', () => {
    const sunset = sunsetOf(Date.parse('2027-02-15T16:40+09:00'), [144.2, 43.05])
    expect(sunset).not.toBeNull()
    const hhmm = formatJstTime(sunset ?? 0)
    expect(hhmm >= '16:45' && hhmm <= '17:05').toBe(true)
  })
})

describe('静的な決まり', () => {
  it('UC-11a: features/drive のソースに Math.random が無い（乱数はシード付き）', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(p)
      }
    }
    walk(root)
    expect(files.length).toBeGreaterThan(5)
    // 呼び出し（Math.random(...)）だけを探す。コメントの言及は数えない
    const offenders = files.filter((f) => /Math\.random\s*\(/.test(readFileSync(f, 'utf-8')))
    expect(offenders).toEqual([])
  })
})
