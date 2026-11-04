// 喪失（A-6）の定数（docs/specs/loss/functional.md R5・R7）。

/** Claude の出力が外れたときの作り直し（最初の 1 回 + 1 回） */
export const MAX_LOSS_WRITER_ATTEMPTS = 2
/** 喪失文の上限（@antler/schema の LocalizedText と同じ 400） */
export const STORY_MAX_LENGTH = 400
/** その日に済ませた楽しみの数の上限（1 日に入る楽しみは 10 件まで） */
export const MAX_ACHIEVED_STOPS = 10
/** 1 つの旅に保存できる喪失文の数（R6。鍵を変えて Claude を呼ばせ続けられないように） */
export const MAX_LOSSES_PER_TRIP = 20
/** 保存の鍵の版（記述子の正規化を変えたら上げる） */
export const LOSS_KEY_VERSION = 'loss:v1'
