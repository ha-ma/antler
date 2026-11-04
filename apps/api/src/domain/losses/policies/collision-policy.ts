import type { LocalizedText, TripLang } from '../../trips/models/trip-writing.js'
import { canonicalJson } from '../../trips/policies/trip-identity-policy.js'
import type { CollisionDescriptor, LossBrief, LossDayContext } from '../models/loss.js'
import { LOSS_KEY_VERSION, MAX_ACHIEVED_STOPS } from '../rules/loss-rules.js'

// 衝突の記述子の検証・Claude に渡す材料・保存の鍵（docs/specs/loss/functional.md R5〜R7、UC-5a・UC-6b）。
// 保存したしおり（LossDayContext。usecase が @antler/trip から作る）と突き合わせる。純粋関数。

/**
 * 記述子が保存したしおりと合うか。問題の一覧（空なら通る）。
 * @param atJstDate 衝突の時刻の JST の暦日（YYYY-MM-DD）。読めない時刻は null
 */
export function checkCollision(
  days: readonly LossDayContext[],
  collision: CollisionDescriptor,
  atJstDate: string | null,
): string[] {
  const today = days.find((d) => d.day === collision.day)
  if (!today) return ['day: 旅の日数の範囲外']
  const problems: string[] = []
  if (!Number.isInteger(collision.leg) || collision.leg < 0 || collision.leg >= today.legs.length)
    problems.push('leg: その日の移動の範囲外')
  if (atJstDate === null) problems.push('at: 読めない時刻')
  else if (atJstDate !== today.date) problems.push('at: その日の日付と違う')
  const ids = collision.achievedStops
  if (ids.length > MAX_ACHIEVED_STOPS) problems.push('achievedStops: 多すぎる')
  if (new Set(ids).size !== ids.length) problems.push('achievedStops: 重複')
  const known = new Map(today.stops.map((s) => [s.id, s.base]))
  if (ids.some((id) => !known.has(id))) problems.push('achievedStops: その日の楽しみではない')
  else if (problems.every((p) => !p.startsWith('leg:'))) {
    // 衝突した移動までに出発した町（legs[0..leg].from）の楽しみだけが済ませられる（R7）
    const departed = new Set(today.legs.slice(0, collision.leg + 1).map((l) => l.fromId))
    if (ids.some((id) => !departed.has(known.get(id) ?? '')))
      problems.push('achievedStops: 衝突した移動より先の町の楽しみ')
  }
  return problems
}

function uniqueByJa(list: LocalizedText[]): LocalizedText[] {
  const seen = new Set<string>()
  return list.filter((t) => (seen.has(t.ja) ? false : (seen.add(t.ja), true)))
}

/** Claude に渡す材料。checkCollision を通った記述子だけを渡す */
export function buildLossBrief(input: {
  lang: TripLang
  partySize: number
  days: readonly LossDayContext[]
  collision: CollisionDescriptor
}): LossBrief {
  const { days, collision } = input
  const today = days.find((d) => d.day === collision.day)
  const leg = today?.legs[collision.leg]
  if (!today || !leg) throw new RangeError('checkCollision を通っていない記述子')
  const done = new Set(collision.achievedStops)
  const achieved: LocalizedText[] = []
  const lost: LocalizedText[] = []
  for (const d of days) {
    for (const stop of d.stops) {
      const reached = d.day < collision.day || (d.day === collision.day && done.has(stop.id))
      ;(reached ? achieved : lost).push(stop.name)
    }
  }
  const lostStays = uniqueByJa(
    days.flatMap((d) => (d.day >= collision.day && d.stay !== null ? [d.stay] : [])),
  )
  return {
    lang: input.lang,
    partySize: input.partySize,
    totalDays: days.length,
    collisionDay: collision.day,
    lostDays: days.length - collision.day + 1,
    collisionLeg: { from: leg.from, to: leg.to },
    achieved,
    lost,
    lostStays,
    alertEnabled: collision.alertEnabled,
  }
}

/**
 * 保存の鍵の材料（R6）。文の材料を決める欄だけで作る。時刻は入れない（秒を変えて Claude を呼ばせない）。
 * 済ませた楽しみは並べ替える（順が違っても同じ鍵。IDEM-1）。usecase がこれをハッシュにする。
 */
export function lossKeyMaterial(tripId: string, collision: CollisionDescriptor): string {
  return `${LOSS_KEY_VERSION}:${canonicalJson({
    tripId,
    day: collision.day,
    leg: collision.leg,
    alertEnabled: collision.alertEnabled,
    achievedStops: [...collision.achievedStops].sort(),
  })}`
}
