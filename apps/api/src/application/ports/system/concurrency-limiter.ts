// 同時に走らせる数の上限（Claude の同時呼び出し）。待たずに、空きが無ければ null を返す。

export interface ConcurrencyLimiter {
  /** 空きがあれば枠を取り、返す関数で枠を返す。空きが無ければ null */
  tryAcquire(): (() => void) | null
}
