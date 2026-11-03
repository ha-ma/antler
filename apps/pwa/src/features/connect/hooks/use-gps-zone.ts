import type { GpsZone } from '@antler/alert-ui'
import {
  judgeZone,
  POOR_ACCURACY_M,
  STALE_MS,
  toGpsZone,
  type Fix,
  type ZoneCollection,
  type ZoneJudgement,
} from '@antler/zones'
import { useEffect, useState } from 'react'
import { watchFixes, type GeoWatch } from '../lib/gps'

export type GpsView = {
  /** deriveAlertState に渡す GPS 側の判定 */
  gps: GpsZone
  judgement: ZoneJudgement | null
  /** 許可はあるが、10 秒たっても測位が無い・測位が古くなった */
  lost: boolean
  /** 誤差が 100 m を超えて inside（残り km を出さない） */
  poorAccuracy: boolean
  /** 購読中に許可なしのエラーが届いた */
  denied: boolean
}

type Track = { fix: Fix | null; denied: boolean }

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
  const [startedAt] = useState(() => Date.now())
  const [track, setTrack] = useState<Track>({ fix: null, denied: false })
  const [previous, setPrevious] = useState<ZoneJudgement | null>(null)

  // 位置の購読（外部の GPS との同期）
  // eslint-disable-next-line no-restricted-syntax -- 購読
  useEffect(() => {
    if (!enabled) return undefined
    // 許可が戻って購読し直したとき、前の許可なしの記録を引きずらない
    setTrack((t) => (t.denied ? { ...t, denied: false } : t))
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
      ? now - startedAt > STALE_MS
      : now - lastFix.timestamp > STALE_MS || judgement?.status === 'unknown')

  const poorAccuracy =
    judgement?.status === 'inside' && (judgement.lastFix?.accuracyM ?? 0) > POOR_ACCURACY_M

  let gps: GpsZone = judgement ? toGpsZone(judgement) : { status: 'unknown' }
  // 誤差が大きいときは残り km を出さない（zones W-3）。琥珀は保つ
  if (poorAccuracy) gps = { status: 'inside' }

  return { gps, judgement, lost, poorAccuracy, denied: track.denied }
}
