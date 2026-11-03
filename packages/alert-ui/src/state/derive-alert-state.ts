import type { ReceivedFlag, Side } from '@antler/schema'

// 表示する 3 状態を、最新のフラグ・その受信時刻・GPS のゾーン判定・前の状態から決める（functional.md R2）。
// 純粋関数。時刻は引数で受ける（resilience.md「deriveAlertState は冪等」）。
// - 赤の解除（1.5 秒検知なし）は edge（A はシミュレーター）が数える。ここでは数えない
// - 最後が deer:true のまま届かなくなったら、受信から 5 秒は danger のまま（危険側に倒す。ch6「B 可用性」）

/** フラグを「新しい」とみなす時間。切断・停止のあと、この間は最後のフラグを信じる。 */
export const FLAG_FRESH_MS = 5000

export type AlertStateName = 'safe' | 'zone' | 'danger'

/** スマホ側の GPS × 鹿ゾーン DB の判定（PWA が作る。A はシミュレーターが作る）。 */
export type GpsZone =
  | { status: 'inside'; remainingKm?: number }
  | { status: 'outside'; distanceKm?: number }
  | { status: 'unknown' }

export type DerivedAlert = {
  state: AlertStateName
  /** safe / zone は km、danger は m。分からなければ undefined（表示は「--」） */
  distance: number | undefined
  /** danger のときの方向。無ければ前方の矢印 */
  side?: Side
  /** ゾーンの内側か（danger の間も持ち越す。解除後に zone と safe のどちらへ戻るかに使う） */
  inZone: boolean
}

export type AlertInputs = {
  flag: ReceivedFlag | null
  /** flag を受け取った時刻（ms）。flag が無ければ null */
  flagReceivedAt: number | null
  gps: GpsZone
  now: number
  previous: DerivedAlert | null
}

export function deriveAlertState({
  flag,
  flagReceivedAt,
  gps,
  now,
  previous,
}: AlertInputs): DerivedAlert {
  // 時計が後ろへ戻ったら経過 0 として扱う（danger を早く解かない。FAIL-5）
  const age = flagReceivedAt === null ? Number.POSITIVE_INFINITY : Math.max(0, now - flagReceivedAt)
  const fresh = flag !== null && age <= FLAG_FRESH_MS ? flag : null

  const inZone = resolveInZone(fresh, gps, previous)

  if (fresh?.deer) {
    const danger: DerivedAlert = { state: 'danger', distance: fresh.distanceM, inZone }
    if (fresh.side) danger.side = fresh.side
    return danger
  }

  if (inZone) {
    const remaining = gps.status === 'inside' ? gps.remainingKm : undefined
    return {
      state: 'zone',
      distance: remaining ?? fresh?.zoneRemainingKm ?? keptDistance(previous, 'zone', gps),
      inZone: true,
    }
  }

  const toNext = gps.status === 'outside' ? gps.distanceKm : undefined
  return {
    state: 'safe',
    distance: toNext ?? fresh?.zoneDistanceKm ?? keptDistance(previous, 'safe', gps),
    inZone: false,
  }
}

/** フラグと GPS のどちらかが inside なら内側。どちらも分からなければ前の状態を保つ。 */
function resolveInZone(fresh: ReceivedFlag | null, gps: GpsZone, previous: DerivedAlert | null) {
  if (gps.status === 'inside' || fresh?.zone === 'inside') return true
  if (gps.status === 'outside' || fresh?.zone === 'outside') return false
  return previous?.inZone ?? false
}

/** GPS が分からないときだけ、同じ状態の前の距離を持ち越す。 */
function keptDistance(previous: DerivedAlert | null, state: AlertStateName, gps: GpsZone) {
  return gps.status === 'unknown' && previous?.state === state ? previous.distance : undefined
}
