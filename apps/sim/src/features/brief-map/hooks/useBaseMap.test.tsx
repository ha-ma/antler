import { tokens } from '@antler/alert-ui'
import { act, render } from '@testing-library/react'
import { MAP_LOAD_TIMEOUT_MS, useBaseMap, type BaseMapState } from './useBaseMap'

// 地図の背景（MapLibre）の縮退（docs/specs/brief-map/functional.md R9・UC-9e、resilience.md FAIL-2・FAIL-3）。
// MapLibre は偽物に差し替え、WebGL2 があることにする。

type Handler = () => void

class FakeMap {
  static last: FakeMap | null = null
  readonly options: Record<string, unknown>
  readonly handlers = new Map<string, Handler[]>()
  readonly painted: [string, string, string][] = []
  removed = false
  isLoaded = false

  constructor(options: Record<string, unknown>) {
    this.options = options
    FakeMap.last = this
  }
  on(event: string, handler: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler])
    return this
  }
  emit(event: string) {
    if (event === 'load') this.isLoaded = true
    for (const h of this.handlers.get(event) ?? []) h()
  }
  loaded() {
    return this.isLoaded
  }
  remove() {
    this.removed = true
  }
  project([lon, lat]: [number, number]) {
    return { x: lon * 10, y: lat * 10 }
  }
  getStyle() {
    return {
      layers: [
        { id: 'background', type: 'background' },
        { id: 'water', type: 'fill' },
        { id: 'roads', type: 'line' },
      ],
    }
  }
  setPaintProperty(id: string, prop: string, value: string) {
    this.painted.push([id, prop, value])
  }
  resize() {}
  fitBounds() {}
}

vi.mock('../map/load-maplibre', () => ({
  loadMapLibre: () => Promise.resolve({ Map: FakeMap }),
}))

const bounds = { west: 141.6, south: 42.7, east: 144.4, north: 43.1 }
let latest: BaseMapState | null = null

function Probe() {
  const { ref, state } = useBaseMap(bounds)
  latest = state
  return <div ref={ref} />
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('WebGL2RenderingContext', class {})
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  FakeMap.last = null
  latest = null
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const flush = () =>
  act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })

describe('useBaseMap', () => {
  it('UC-9e: interactive: false で作り、load で tokens の陸・水に塗り直して MapLibre の投影を使う', async () => {
    render(<Probe />)
    await flush()
    const map = FakeMap.last
    expect(map?.options).toMatchObject({ interactive: false, attributionControl: false })
    act(() => map?.emit('load'))
    expect(latest?.mode).toBe('map')
    expect(latest?.project?.([144, 43])).toEqual([1440, 430])
    expect(map?.painted).toEqual([
      ['background', 'background-color', tokens.color.trip['map-land']],
      ['water', 'fill-color', tokens.color.trip['map-water']],
    ])
  })

  it('FAIL-2: load の前に error → 背景なしにして map.remove()', async () => {
    render(<Probe />)
    await flush()
    act(() => FakeMap.last?.emit('error'))
    expect(latest?.mode).toBe('fallback')
    expect(FakeMap.last?.removed).toBe(true)
  })

  it('FAIL-3 / UC-9e: 8 秒で load が来ない → 背景なし。後から load が来ても背景なしのまま', async () => {
    render(<Probe />)
    await flush()
    act(() => vi.advanceTimersByTime(MAP_LOAD_TIMEOUT_MS))
    expect(latest?.mode).toBe('fallback')
    const map = FakeMap.last
    expect(map?.removed).toBe(true)
    act(() => map?.emit('load'))
    expect(latest?.mode).toBe('fallback')
  })

  it('load の後の error（タイルの一部が欠ける）では背景を外さない', async () => {
    render(<Probe />)
    await flush()
    act(() => FakeMap.last?.emit('load'))
    act(() => FakeMap.last?.emit('error'))
    expect(latest?.mode).toBe('map')
  })

  it('外すときに map.remove() を呼ぶ', async () => {
    const view = render(<Probe />)
    await flush()
    view.unmount()
    expect(FakeMap.last?.removed).toBe(true)
  })
})
