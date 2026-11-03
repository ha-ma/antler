import { toJst, type AlertFlag } from '@antler/schema'
import type { Sighting } from './detection'

// シミュレーターが作るフラグ（R6）。B の edge（edge/detector/src/detector/flag.py の build_flag）と同じ意味にする:
// edge は GPS を持たないので zone は常に outside。ゾーンの内外は GPS 側（A では zoneStatusAt）だけが決める。
// こうしないと、解除の deer:false に zone:inside を入れたまま出口を越えたとき、deriveAlertState が
// 5 秒（FLAG_FRESH_MS）琥珀を残す（alert-contract-guard W-1）。
// 受け取る側と同じく readAlertFlag に通して strict を決める（W-3）。

/** シミュレーションの時刻 atMs（epoch ms）で、検知した鹿（無ければ解除）のフラグを作る */
export function buildSimFlag(atMs: number, sighting: Sighting | null): AlertFlag {
  const at = toJst(new Date(atMs).toISOString())
  const base = { type: 'flag', v: 1, t_frame: at, t_sent: at, zone: 'outside' } as const
  if (!sighting) return { ...base, deer: false }
  return {
    ...base,
    deer: true,
    conf: 0.9,
    distanceM: Math.round(sighting.distanceM),
    side: sighting.side,
  }
}
