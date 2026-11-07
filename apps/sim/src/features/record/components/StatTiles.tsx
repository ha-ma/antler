import { recordText, type RecordView } from '@antler/trip'
import { CountUpText } from '@/shared/components/CountUpText'

// StatTile 4 つ（docs/specs/record/functional.md R5）。ラベル caption → 値 num-l、単位は 40 %。
// 値は見えたときに数え上げる（docs/specs/result-countup/functional.md R1・R5）。文字列は buildRecordView のまま
// （api の SSR と同じ）。「守れた楽しみ」の総数（分母）は動かさない。「遭遇 / 回避」は両方とも数えた回数なので両方動く。
// 「クリア」の円が描き始めてから、100 ms ずつずらす。

const START_MS = 300
const STAGGER_MS = 100
const PLEASURES_HOLD = [1] as const

export function StatTiles({ view }: { view: RecordView }) {
  return (
    <dl className="record-stats" aria-label={recordText('statsLabel', view.lang)}>
      {view.stats.map((s, i) => (
        <div key={s.key} className={`record-stat record-stat--${s.key}`}>
          <dt>{s.label}</dt>
          <dd>
            <CountUpText
              text={s.value}
              hold={s.key === 'pleasures' ? PLEASURES_HOLD : undefined}
              notBeforeMs={START_MS + i * STAGGER_MS}
            />
            {s.unit ? <small>{s.unit}</small> : null}
          </dd>
        </div>
      ))}
    </dl>
  )
}
