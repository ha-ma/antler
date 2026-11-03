import { metersBetween, type LonLat } from '@antler/zones'
import { pointAtKm } from './day-plan'

// 線の [fromKm, toKm] の部分（functional.md R9。画面がゾーンの帯をルートから切り出して描く。planRoute と同じ物差し）

export function sliceByKm(line: readonly LonLat[], fromKm: number, toKm: number): LonLat[] {
  const from = Math.max(0, fromKm) * 1000
  const to = toKm * 1000
  const out: LonLat[] = [pointAtKm(line, from / 1000)]
  let walked = 0
  for (let i = 0; i + 1 < line.length; i++) {
    walked += metersBetween(line[i] as LonLat, line[i + 1] as LonLat)
    if (walked > from && walked < to) out.push(line[i + 1] as LonLat)
  }
  const end = pointAtKm(line, to / 1000)
  const last = out[out.length - 1] as LonLat
  if (out.length < 2 || end[0] !== last[0] || end[1] !== last[1]) out.push(end)
  return out
}
