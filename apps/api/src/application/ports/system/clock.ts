// 時計。冪等キーの期限・1 日の上限・作成日時に使う。テストでは止めた時計に差し替える。

export interface Clock {
  nowMs(): number
}
