import { tokens } from '@antler/alert-ui'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { useEffect, useState } from 'react'
import { logger } from '@/shared/utils/logger'
import { loadMapLibre } from '../map/load-maplibre'
import { fitProjection, type Bounds, type Project, type Size } from '../map/projection'
import { mapStyleUrl, webglAvailable } from '../map/style'

// 地図の背景（MapLibre）と SVG の投影（docs/specs/brief-map/functional.md R9、resilience.md）。
// MapLibre は外部のシステムなので、要素ができたら useEffect で作って片付ける。
// 背景を出せない（WebGL なし・スタイルの失敗・8 秒でスタイルが読めない・VITE_MAP_STYLE_URL=off）→ 背景なしの投影。
// 一度背景なしにしたら、その表示のあいだは戻さない（遅れて届いたスタイルは捨てる）。地図は動かさない（interactive: false）。

export const MAP_LOAD_TIMEOUT_MS = 8000
/** ルートの周りの余白（px） */
export const MAP_PADDING = 48
/** 要素の大きさが読めないとき（jsdom）の枠。アートボードの SVG と同じ */
export const DEFAULT_SIZE: Size = { width: 820, height: 480 }

export type BaseMapState =
  | { mode: 'loading'; project: null; size: Size }
  | { mode: 'map' | 'fallback'; project: Project; size: Size }

const sizeOf = (el: HTMLElement): Size =>
  el.clientWidth > 0 && el.clientHeight > 0
    ? { width: el.clientWidth, height: el.clientHeight }
    : DEFAULT_SIZE

/** 陸と水を tokens の map-land・map-water で塗り直す（背景の色もトークンにそろえる） */
function paintWithTokens(map: MapLibreMap): void {
  const colors = tokens.color.trip
  for (const layer of map.getStyle().layers) {
    if (layer.type === 'background')
      map.setPaintProperty(layer.id, 'background-color', colors['map-land'])
    else if (layer.type === 'fill' && layer.id.includes('water'))
      map.setPaintProperty(layer.id, 'fill-color', colors['map-water'])
  }
}

/**
 * bounds はその日のルートの範囲。要素は返す ref のコールバックで受け取る。
 * 返す state.project で経度・緯度を枠のピクセルにする（mode が変わるか大きさが変わると作り直す）。
 */
export function useBaseMap(bounds: Bounds | null) {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const [state, setState] = useState<BaseMapState>({
    mode: 'loading',
    project: null,
    size: DEFAULT_SIZE,
  })
  const boundsKey = bounds ? JSON.stringify(bounds) : null

  // useEffect の理由: MapLibre（DOM と WebGL を持つ外部のシステム）を要素に合わせて作り、外すときに片付けるため
  // （.claude/rules/react-hooks-rules.md: 外部の購読・タイマーは hooks/ の中で理由つきでだけ使う）
  // eslint-disable-next-line no-restricted-syntax -- 上の理由。データ取得・派生値には使っていない
  useEffect(() => {
    if (!element || !boundsKey) return
    const box = JSON.parse(boundsKey) as Bounds
    let disposed = false
    let map: MapLibreMap | null = null
    let fellBack = false
    /** スタイルが読めて背景を出した */
    let ready = false

    const fallback = (reason: string) => {
      if (disposed || fellBack) return
      fellBack = true
      clearTimeout(timer)
      map?.remove()
      map = null
      logger.warn('brief.map.fallback', { reason })
      const size = sizeOf(element)
      setState({ mode: 'fallback', project: fitProjection(box, size, MAP_PADDING), size })
    }

    const showMap = (m: MapLibreMap) => {
      const size = sizeOf(element)
      setState({
        mode: 'map',
        project: (p) => {
          const point = m.project([p[0], p[1]])
          return [point.x, point.y]
        },
        size,
      })
    }

    const timer = setTimeout(() => fallback('timeout'), MAP_LOAD_TIMEOUT_MS)
    const styleUrl = mapStyleUrl()
    if (!styleUrl) fallback('off')
    else if (!webglAvailable()) fallback('unsupported')
    else {
      loadMapLibre()
        .then((maplibre) => {
          if (disposed || fellBack) return
          const m = new maplibre.Map({
            container: element,
            style: styleUrl,
            interactive: false,
            attributionControl: false,
            bounds: [
              [box.west, box.south],
              [box.east, box.north],
            ],
            fitBoundsOptions: { padding: MAP_PADDING, animate: false },
          })
          map = m
          // スタイルが読めた時点で出す（タイルは後から埋まる。load は全タイルを待つので遅い回線で 8 秒を越える）
          const onReady = () => {
            if (disposed || fellBack || ready) return
            ready = true
            clearTimeout(timer)
            paintWithTokens(m)
            showMap(m)
          }
          m.on('style.load', onReady)
          m.on('load', onReady)
          m.on('error', () => {
            if (!ready) fallback('error')
          })
        })
        .catch(() => fallback('chunk'))
    }

    // 枠の大きさが変わったら合わせ直して投影し直す
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (disposed) return
            if (fellBack) {
              const size = sizeOf(element)
              setState({ mode: 'fallback', project: fitProjection(box, size, MAP_PADDING), size })
            } else if (map && ready) {
              map.resize()
              map.fitBounds(
                [
                  [box.west, box.south],
                  [box.east, box.north],
                ],
                { padding: MAP_PADDING, animate: false },
              )
              showMap(map)
            }
          })
    observer?.observe(element)

    return () => {
      disposed = true
      clearTimeout(timer)
      observer?.disconnect()
      map?.remove()
    }
  }, [element, boundsKey])

  return { ref: setElement, state }
}
