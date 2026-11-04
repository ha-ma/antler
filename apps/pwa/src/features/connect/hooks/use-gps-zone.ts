import type { GpsZone } from '@antler/alert-ui'
import {
  judgeZone,
  POOR_ACCURACY_M,
  STALE_MS,
  toGpsZone,
  type Fix,
  type ZoneCollection,
  type RoadName,
  type ZoneJudgement,
} from '@antler/zones'
import { useEffect, useState } from 'react'
import { watchFixes, type GeoWatch } from '../lib/gps'
import { toVehicleReport, type VehicleReport } from '../lib/vehicle-report'

export type GpsView = {
  /** deriveAlertState に渡す GPS 側の判定 */
  gps: GpsZone
  /** 画面に出す路線名（4 言語）。座標を含む判定の結果そのものは返さない */
  roadName: RoadName | undefined
  /** outside のときの到達予定（JST の ISO 8601） */
  eta: string | undefined
  /** 許可はあるが、10 秒たっても測位が無い・測位が古くなった */
  lost: boolean
  /** 誤差が 100 m を超えて inside（残り km を出さない） */
  poorAccuracy: boolean
  /** 購読中に許可なしのエラーが届いた */
  denied: boolean
  /** edge の L1 に返す車の状態（速度・ゾーン・光）。座標は含まない。3 項目とも分からなければ null（pwa-uplink） */
  vehicle: VehicleReport | null
}

type Track = { fix: Fix | null; denied: boolean; startedAt: number }

function sameJudgement(a: ZoneJudgement | null, b: ZoneJudgement | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * スマホの GPS × 鹿ゾーンの判定（pwa-drive R1・R2・R4・R5）。
 * 測位が届いたときと、1 秒ごと（now が進むたび）に judgeZone を呼び直す。前回の結果を渡し続ける。
 * 座標は state の中だけで使い、外に出さない。
 */
export function useGpsZone({
  geo,
  enabled,
  zones,
  now,
}: {
  geo: GeoWatch | undefined
  enabled: boolean
  zones: ZoneCollection | null
  now: number
}): GpsView {
  const [track, setTrack] = useState<Track>(() => ({
    fix: null,
    denied: false,
    startedAt: Date.now(),
  }))
  const [previous, setPrevious] = useState<ZoneJudgement | null>(null)

  // 位置の購読（外部の GPS との同期）
  // eslint-disable-next-line no-restricted-syntax -- 購読
  useEffect(() => {
    if (!enabled) return undefined
    // 購読を始める（許可が戻って始め直したときも）。前の許可なしの記録と、待ち始めの時刻を引きずらない
    setTrack({ fix: null, denied: false, startedAt: Date.now() })
    return watchFixes(
      geo,
      (fix) => {
        setTrack((t) => ({ ...t, fix }))
      },
      () => {
        setTrack((t) => ({ ...t, denied: true }))
      },
    )
  }, [enabled, geo])

  const judgement = zones && enabled ? judgeZone({ fix: track.fix, now, previous, zones }) : null
  if (!sameJudgement(previous, judgement)) setPrevious(judgement)

  const lastFix = track.fix
  // 測位が無い・古い、または測位は届くのに使えない（北海道の外、誤差が大きすぎる）。どれも琥珀のまま理由を出す
  const lost =
    enabled &&
    !track.denied &&
    (lastFix === null
      ? now - track.startedAt > STALE_MS
      : now - lastFix.timestamp > STALE_MS || judgement?.status === 'unknown')

  const poorAccuracy =
    judgement?.status === 'inside' && (judgement.lastFix?.accuracyM ?? 0) > POOR_ACCURACY_M

  let gps: GpsZone = judgement ? toGpsZone(judgement) : { status: 'unknown' }
  // 誤差が大きいときは残り km を出さない（zones W-3）。琥珀は保つ
  if (poorAccuracy) gps = { status: 'inside' }

  const roadName =
    judgement?.status === 'inside' || judgement?.status === 'outside'
      ? judgement.roadName
      : undefined
  const eta = judgement?.status === 'outside' ? judgement.eta : undefined
  // 位置は state の中で派生値（速度・内外・光）にして、外へは派生値だけを出す
  const vehicle = enabled
    ? toVehicleReport({ fix: track.fix, now, status: judgement?.status ?? null })
    : null
  return { gps, roadName, eta, lost, poorAccuracy, denied: track.denied, vehicle }
}
