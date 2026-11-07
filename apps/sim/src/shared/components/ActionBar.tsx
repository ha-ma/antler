import type { ReactNode } from 'react'
import './action-bar.css'

// 画面の下に固定する帯（docs/specs/sticky-cta/functional.md R1・R2）。各画面の「次へ進む」主ボタンを 1 つだけ載せる。
// 主ボタンは今の DOM の位置のまま帯に入れる（Tab と読み上げの順を変えない。同じボタンを 2 つ描かない）。
// 主ボタンの要素には `ACTION_BAR_PRIMARY` の class を付ける（見た目と注意の動きは action-bar.css）。
// 帯を出す画面は、本文の下の余白に `--action-bar-reserve` を足す（帯が本文を隠さない）。

/** 主ボタンに付ける class（ボタン・リンクのどちらでもよい） */
export const ACTION_BAR_PRIMARY = 'action-bar__primary'

type Props = {
  /** 主ボタン（1 つ） */
  children: ReactNode
  /** 主ボタンの左（狭い画面は上）に出す補足。直すところ・失敗の知らせなど。無ければ箱を描かない */
  note?: ReactNode
}

export function ActionBar({ children, note }: Props) {
  return (
    <div className="action-bar" data-testid="action-bar">
      <div className="action-bar__inner">
        {note ? <div className="action-bar__note">{note}</div> : null}
        {children}
      </div>
    </div>
  )
}
