import { FIVE_DAYS, FIVE_DAYS_D1, FIVE_DAYS_D2, FIVE_DAYS_D5 } from './fixtures'
import { strikeItinerary, type ItineraryRow } from './strike'

// UC-2（R2）: しおりの取り消し線。前の日は予定どおり済んだとみなす。

const at = '2027-02-15T16:31:00+09:00'
const brief = (rows: ItineraryRow[]) =>
  rows.map((r) => {
    const what =
      r.kind === 'route' || r.kind === 'collision'
        ? `${r.from}>${r.to}`
        : r.kind === 'stop'
          ? r.id
          : `stay:${r.place}`
    return `D${String(r.day)} ${r.kind} ${what} ${r.status}`
  })

describe('strikeItinerary', () => {
  it('UC-2a: D2 の 2 本目の移動で衝突・タンチョウ達成 → D1 は achieved、✕ はタンチョウの後、残りは lost', () => {
    const rows = strikeItinerary(FIVE_DAYS, FIVE_DAYS_D2, {
      day: 2,
      leg: 1,
      at,
      achievedStops: ['red-crowned-crane'],
    })
    expect(brief(rows)).toEqual([
      'D1 route cts>kushiro achieved',
      'D1 stay stay:kushiro achieved',
      'D2 stop red-crowned-crane achieved',
      'D2 collision tsurui>akan collision',
      'D2 stop akan-onsen lost',
      'D2 stay stay:akan lost',
      'D3 route akan>utoro lost',
      'D3 stop drift-ice-walk lost',
      'D3 stay stay:utoro lost',
      // 移動の無い日（from = to）は行程の行を出さず、宿だけ
      'D4 stay stay:utoro lost',
      // 宿の無い最終日も行程の行で消える
      'D5 route utoro>cts lost',
    ])
    const collision = rows.find((r) => r.kind === 'collision')
    expect(collision).toMatchObject({ at })
  })

  it('UC-2b: D1 の最初の移動で衝突・達成なし → ✕ が先頭、残りはすべて lost', () => {
    const rows = strikeItinerary(FIVE_DAYS, FIVE_DAYS_D1, { day: 1, leg: 0, at, achievedStops: [] })
    expect(rows[0]).toMatchObject({ kind: 'collision', day: 1, from: 'cts', to: 'kushiro' })
    expect(rows.slice(1).every((r) => r.status === 'lost')).toBe(true)
    expect(rows.some((r) => r.status === 'achieved')).toBe(false)
  })

  it('UC-2a: 達成した楽しみはしおりの順に並ぶ（achievedStops の順ではない）', () => {
    const rows = strikeItinerary(FIVE_DAYS, FIVE_DAYS_D2, {
      day: 2,
      leg: 1,
      at,
      achievedStops: ['akan-onsen', 'red-crowned-crane'],
    })
    expect(brief(rows).slice(2, 5)).toEqual([
      'D2 stop red-crowned-crane achieved',
      'D2 stop akan-onsen achieved',
      'D2 collision tsurui>akan collision',
    ])
  })

  it('UC-2a: 最終日の衝突 → 前の 4 日は achieved、最終日は ✕ だけ', () => {
    const rows = strikeItinerary(FIVE_DAYS, FIVE_DAYS_D5, { day: 5, leg: 0, at, achievedStops: [] })
    expect(rows.at(-1)).toMatchObject({ kind: 'collision', day: 5 })
    expect(rows.slice(0, -1).every((r) => r.status === 'achieved')).toBe(true)
  })
})
