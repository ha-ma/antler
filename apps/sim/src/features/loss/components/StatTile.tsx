import type { ReactNode } from 'react'
import { dropClass, type DropStyle } from '../utils/drop'

type Props = {
  label: string
  value: ReactNode
  note: ReactNode
  /** 金額は clay（喪失の金額。alert-danger は使わない。R3） */
  tone?: 'clay' | 'ink'
  /** 落ちて積み重なる並びの番号と傾き（result-screens R2） */
  drop?: DropStyle
}

/** StatTile（docs/design/README.md）: surface ＋ line、ラベル caption → 値 num-l */
export function StatTile({ label, value, note, tone = 'ink', drop }: Props) {
  return (
    <div className={dropClass('loss-tile', drop)} style={drop}>
      <dt className="loss-tile__label">{label}</dt>
      <dd className={`loss-tile__value loss-tile__value--${tone}`}>{value}</dd>
      <dd className="loss-tile__note">{note}</dd>
    </div>
  )
}
