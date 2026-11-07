// 数え上げの 1 コマ（docs/specs/result-countup/functional.md R2）。
// 出来上がった文字列（例: 「¥615,000（約 $4,100）」「3 / 4」「1.2」）の中の数字の並びだけを、進みに合わせて替える。
// 数字でない部分（記号・空白・単位・括弧）はそのまま。途中のコマは元の数字と同じ小数の桁数・3 桁区切りの有無で書く。
// 進み 1 のコマは元の文字列をそのまま返す（作り直さない。今の表示と 1 文字も違わない）。

/** 3 桁区切り（カンマ）つき、または区切りなしの数字。小数を含む */
const NUMBER_RE = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g

/** ease-out（3 次）。t は 0〜1 */
export function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

export function hasNumber(text: string): boolean {
  return new RegExp(NUMBER_RE.source).test(text)
}

/**
 * 進み（ease を当てたあとの 0〜1）のコマ。
 * hold は動かさない数字の並びの番号（0 から。例: 「1 / 2」の分母は 1）
 */
export function countUpFrame(text: string, progress: number, hold: readonly number[] = []): string {
  if (progress >= 1) return text
  let index = -1
  return text.replace(NUMBER_RE, (token) => {
    index += 1
    if (hold.includes(index)) return token
    const decimals = token.split('.')[1]?.length ?? 0
    const value = Number(token.replace(/,/g, '')) * Math.max(0, progress)
    return value.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: token.includes(','),
    })
  })
}
