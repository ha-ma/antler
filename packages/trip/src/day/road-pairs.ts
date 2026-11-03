import type { LonLat } from '@antler/zones'
import { PLACES } from '../places'
import type { Area } from '../types'

// routes.json に持つ 2 地点の組（docs/specs/brief-map/functional.md R1）。
// しおりの移動は「玄関口（空港・駅）と、そのエリアの拠点」の中だけで起きるので、エリアごとにその全ての組を持つ。
// 向きは 1 つ（id の小さい方 → 大きい方）。逆向きは同じ線を逆にたどる。

/**
 * 冬に閉まる道（OSRM は季節の規制を知らない）。取得スクリプトは、この点の近くを通る線を迂回の経由点を足して取り直す。
 * 季節で線を変えず、通年で閉まる区間を避ける（ペルソナは 2 月）。
 */
export const WINTER_CLOSURES: readonly { name: string; at: LonLat; via: LonLat }[] = [
  {
    name: '知床峠（国道 334 号 羅臼〜ウトロ、例年 11 月上旬〜4 月下旬は通行止め）',
    at: [145.087, 44.074],
    /** 斜里（国道 334 号・244 号で回る） */
    via: [144.6703, 43.9097],
  },
]
/** 閉まる道の点からこれ以内を通る線は迂回させる m */
export const CLOSURE_RADIUS_M = 2000

/** 組の鍵。id を辞書順に並べて `|` でつなぐ（向きを問わない） */
export function roadKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/** エリアの移動で通りうる地点（玄関口 ＋ そのエリアの拠点） */
export function placesOfArea(area: Area): string[] {
  return PLACES.filter((p) => p.kind === 'gateway' || p.area === area).map((p) => p.id)
}

/** routes.json に持つべき全ての組（重複なし、辞書順）。[小さい id, 大きい id] */
export function roadPairs(): [string, string][] {
  const keys = new Set<string>()
  for (const area of ['doto', 'doo'] as const) {
    const ids = placesOfArea(area)
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) keys.add(roadKey(ids[i] as string, ids[j] as string))
  }
  return [...keys].sort().map((k) => k.split('|') as [string, string])
}
