import { useState } from 'react'
import { useCountUp } from '../hooks/useCountUp'
import { countUpFrame, easeOutCubic, hasNumber } from '../utils/count-up'
import './count-up.css'

// 出来上がった文字列の数字を 0 から数え上げる（docs/specs/result-countup/functional.md R2〜R6）。
// 動いているあいだだけ 2 つに分ける: 見える数字（aria-hidden）と、最後の値（透明。同じ場所に重ねて幅をとり、読み上げはこれを読む）。
// 終わった・動かさないときは、今の表示と同じ 1 つの文字の並び。

type Props = {
  /** 最後の値（今の表示の文字列そのもの） */
  text: string
  /** 動かさない数字の並びの番号（例: 「1 / 2」の分母は [1]） */
  hold?: readonly number[] | undefined
  /** mount からこれだけ経つまでは始めない */
  notBeforeMs?: number | undefined
  durationMs?: number | undefined
}

export function CountUpText({ text, hold, notBeforeMs, durationMs }: Props) {
  // 値が変わったら数え直さず、新しい値を最後の値として出す（R5）
  const [first] = useState(text)
  const { ref, progress } = useCountUp<HTMLSpanElement>({
    enabled: hasNumber(text),
    notBeforeMs,
    durationMs,
  })
  if (progress === null || text !== first) {
    return (
      <span ref={ref} className="count-up">
        {text}
      </span>
    )
  }
  return (
    <span ref={ref} className="count-up count-up--running">
      <span className="count-up__frame" aria-hidden="true">
        {countUpFrame(text, easeOutCubic(progress), hold)}
      </span>
      <span className="count-up__final">{text}</span>
    </span>
  )
}
