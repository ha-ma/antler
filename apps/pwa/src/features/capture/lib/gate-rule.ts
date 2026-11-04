import type { PendingList } from './edge-api'

/** 最後のフレームからこの秒数が空いていれば、走行中ではないとみなす（P1 (c)） */
export const IDLE_THRESHOLD_SECONDS = 60

/**
 * 走行後の画面を重ねてよいか（P1）。
 * 未送信が 1 件以上あり、edge がフレームを処理している最中（= 走行中）ではないときだけ。
 * 走行中の再読み込みで赤の画面を隠さない（B4-6）。
 */
export function shouldOffer(list: PendingList): boolean {
  if (list.total < 1 || list.items.length < 1) return false
  return list.idleSeconds === null || list.idleSeconds >= IDLE_THRESHOLD_SECONDS
}
