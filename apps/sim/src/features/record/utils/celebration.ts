import type { TripRecord } from '@antler/trip'

// A-7 で「クリア」の祝いを出すか（docs/specs/result-screens/functional.md R4）。
// - A-6（衝突のあと）から来たら一切出さない。合図は location state（URL に書かない）
// - そうでなければ、保存順で最後の run の日（lastDay）が完走なら、その日の「クリア」を出す
// 合図が要るのは、OFF の挑戦の衝突でもその日の結果が ON の完走のまま残る・衝突の run の保存が裏で続く・
// 所有者でない端末は衝突を保存しない、の 3 つで、記録のデータだけでは衝突のあとだと分からないため。

export type RecordArrival = 'after-collision'

/** A-6 の「旅の記録を見る」が `<Link state>` に付ける合図 */
export const RECORD_AFTER_COLLISION: { arrival: RecordArrival } = { arrival: 'after-collision' }

/** location.state（unknown）から合図を読む。合図でない形は null */
export function arrivalOf(state: unknown): RecordArrival | null {
  if (typeof state !== 'object' || state === null || !('arrival' in state)) return null
  return state.arrival === 'after-collision' ? 'after-collision' : null
}

export type Celebration = { day: number }

// 祝いは 1 つの履歴（location.key）につき 1 回（R4）。戻る・再読み込みで同じ履歴に来ても繰り返さない。
// sessionStorage が使えない（プライベートの設定など）ときは覚えない（毎回判定する。画面は出る）。
const CELEBRATED_KEY = 'antler.record.celebrated'
const CELEBRATED_MAX = 20

function readCelebrated(): string[] {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(CELEBRATED_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

/** この履歴でもう祝いを出したか */
export function wasCelebrated(locationKey: string): boolean {
  return readCelebrated().includes(locationKey)
}

/** この履歴で祝いを出したと覚える（新しい 20 件だけ） */
export function markCelebrated(locationKey: string): void {
  const keys = readCelebrated().filter((k) => k !== locationKey)
  keys.push(locationKey)
  try {
    sessionStorage.setItem(CELEBRATED_KEY, JSON.stringify(keys.slice(-CELEBRATED_MAX)))
  } catch {
    // 覚えられなくても画面は出す
  }
}

export function celebrationOf(
  record: TripRecord,
  arrival: RecordArrival | null,
): Celebration | null {
  if (arrival === 'after-collision') return null
  if (record.status === 'not-started') return null
  const last = record.days.find((d) => d.day === record.lastDay)
  return last?.result === 'completed' ? { day: record.lastDay } : null
}
