// 旅の作成の定数（docs/specs/plan-trip/functional.md R5・R7・R8・R9、resilience.md）。

/** 旅の id の長さ（英数）。推測困難な 8 文字（ch6） */
export const TRIP_ID_LENGTH = 8
export const TRIP_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
/** 読み出しで受ける id の形（@antler/schema の TripPlan.id と同じ英数 4〜16 文字。作るのは 8 文字） */
export const TRIP_ID_PATTERN = /^[A-Za-z0-9]{4,16}$/
/** seed の最大（2^32 - 1） */
export const MAX_SEED = 0xffff_ffff
/** id の衝突で作り直す回数（最初の 1 回 + 作り直し 3 回） */
export const MAX_ID_ATTEMPTS = 4

/** Claude の出力が外れたときの作り直し（最初の 1 回 + 1 回） */
export const MAX_WRITER_ATTEMPTS = 2
export const TITLE_MAX_LENGTH = 200
/** 1 行説明の上限（@antler/schema の LocalizedText と同じ） */
export const NOTE_MAX_LENGTH = 400

/** pending のまま 2 分を過ぎたら、api が落ちたとみなして作り直せる */
export const PENDING_STALE_MS = 2 * 60 * 1000
/** 冪等キーは 24 時間後に無視する（threat.md） */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

/** 1 日の上限の「日」は日本時間の暦日 */
export const JST_OFFSET_MS = 9 * 60 * 60 * 1000
export const DAY_MS = 24 * 60 * 60 * 1000
