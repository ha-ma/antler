import type { CSSProperties } from 'react'

// A-6 の「落ちて積み重なる」の並び（docs/specs/result-screens/functional.md R2）。
// 画面の DOM の順（＝読み上げ・Tab の順）に next() を呼び、その要素に `loss-drop` と返した style を付ける。
// 番号（--loss-drop-i）で落ちる遅れが、傾き（--loss-tilt）で止まったときの角度が決まる（loss.css）。
// 後から足す行も next() を受け取れば同じ並びに入る。受け取らない要素は動かずに最初から出る。

/** 止まったときの傾き（度）。乱数を使わない決まった表。わずかに（1° 以内）左右に振る */
export const DROP_TILTS: readonly number[] = [-0.6, 0.8, -0.7, 0.5, -0.9, 0.6, -0.4, 0.9]

export type DropStyle = CSSProperties & { '--loss-drop-i': number; '--loss-tilt': string }

/** 1 枚が落ちきるまでと、次のカードの遅れ（loss.css の --loss-drop-duration・--loss-drop-stagger と同じ値。テストが突き合わせる） */
export const DROP_DURATION_MS = 820
export const DROP_STAGGER_MS = 150

/**
 * そのカードが着地する時刻（mount からの ms）。数え上げはここから始める（result-countup R5）。
 * drop が無ければ 0（動かずに最初から出る要素）
 */
export function dropLandedMs(drop: DropStyle | undefined): number {
  return drop ? drop['--loss-drop-i'] * DROP_STAGGER_MS + DROP_DURATION_MS : 0
}

/** 要素の class に `loss-drop` を足す（drop が無ければそのまま。動かずに最初から出る） */
export function dropClass(base: string, drop: DropStyle | undefined): string {
  return drop ? `${base} loss-drop` : base
}

/** 落ちる順の番号を 0 から配る。tilt を渡せばその傾き（例: しおりのカードの −1.5°） */
export function dropSequence(): (tilt?: number) => DropStyle {
  let i = 0
  return (tilt) => {
    const order = i
    i += 1
    const deg = tilt ?? DROP_TILTS[order % DROP_TILTS.length] ?? 0
    return { '--loss-drop-i': order, '--loss-tilt': `${String(deg)}deg` }
  }
}
