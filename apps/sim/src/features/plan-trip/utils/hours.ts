/** 所要の時間の表示（整数はそのまま、0.5 刻みは小数 1 桁）。 */
export function hoursLabel(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1)
}
